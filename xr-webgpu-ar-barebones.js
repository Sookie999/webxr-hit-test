      // that WebXR will never provide more than two views.
      const MAX_VIEWS = 2;
      // We have two matrices per view, which is only 32 floats, but we're going
      // to allocate 64 of them because uniform buffers bindings must be aligned
      // to 256-bytes.
      const UNIFORM_FLOATS_PER_VIEW = 64; // projection(16) + view(16) + model(16) + padding

      // A simple shader that draws a single triangle
      const SHADER_SRC = `
        struct Camera {
          projection: mat4x4f,
          view: mat4x4f,
          model: mat4x4f,
        }
        @group(0) @binding(0) var<uniform> camera: Camera;

        struct VertexOut {
          @builtin(position) pos: vec4f,
          @location(0) color: vec4f,
        }

        @vertex
        fn vertexMain(@builtin(vertex_index) vert_index: u32,
                      @builtin(instance_index) instance: u32) -> VertexOut {
          // Smaller triangle (reduced by ~10x)
          var pos = array<vec4f, 3>(
            vec4f(0.0, 0.025, -0.5, 1),
            vec4f(-0.025, -0.025, -0.5, 1),
            vec4f(0.025, -0.025, -0.5, 1)
          );

          var color = array<vec4f, 3>(
            vec4f(1, 0, 0, 1),
            vec4f(0, 1, 0, 1),
            vec4f(0, 0, 1, 1)
          );

          // Give each instance an offset. Spread across a shallow grid in front of the camera.
          let ix = f32(instance % 32u);
          let iy = f32((instance / 32u) % 32u);
          let offset = vec4f((ix - 16.0) * 0.01, (iy - 16.0) * 0.01, -0.5 - f32(instance) * 0.0005, 0);
          let instancePos = pos[vert_index] + offset;
          let posOut = camera.projection * camera.view * camera.model * instancePos;

          return VertexOut(posOut, color[vert_index]);
        }

        @fragment
        fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
          return in.color;
        }
      `;

      // XR globals.
      let xrButton = document.getElementById('xr-button');
      let xrSession = null;
      let xrRefSpace = null;

      // WebGPU scene globals.
      let gpuDevice = null;
      let gpuContext = null;
      let gpuUniformBuffer = null;
      let gpuUniformArray = new Float32Array(UNIFORM_FLOATS_PER_VIEW * MAX_VIEWS);
      let gpuBindGroupLayout = null;
      let gpuBindGroups = [];
      let gpuModule = null;
      let gpuPipeline = null;
      let gpuDepthTexture = null;
      let colorFormat = null;
      let depthStencilFormat = 'depth24plus';


      // WebXR/WebGPU interop globals.
      let xrGpuBinding = null;
      let projectionLayer = null;

      // Generate a projection matrix, borrowed from gl-matrix.
      function perspectiveZO(out, fovy, aspect, near, far = Infinity) {
        const f = 1.0 / Math.tan(fovy / 2);
        out[0] = f / aspect;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[5] = f;
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[11] = -1;
        out[12] = 0;
        out[13] = 0;
        out[15] = 0;
        if (far != null && far !== Infinity) {
          const nf = 1 / (near - far);
          out[10] = far * nf;
          out[14] = far * near * nf;
        } else {
          out[10] = -1;
          out[14] = -near;
        }
        return out;
      }

      // Checks to see if WebXR and WebGPU is available and, if so, requests an
      // tests to ensure it supports the desired session type.
      async function initXR() {
        // Is WebXR, WebGPU, and WebXR/WebGPU interop available on this UA?
        if (!navigator.xr) {
          xrButton.textContent = 'WebXR not supported';
          return;
        }

        if (!navigator.gpu) {
          xrButton.textContent = 'WebGPU not supported';
          return;
        }

        if (!('XRGPUBinding' in window)) {
          xrButton.textContent = 'WebXR/WebGPU interop not supported';
          return;
        }

        // If the UA allows creation of immersive AR sessions enable the
        // target of the 'Enter XR' button.
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!supported) {
          xrButton.textContent = 'Immersive AR not supported';
          return;
        }

        // Updates the button to start an XR session when clicked.
        xrButton.addEventListener('click', onButtonClicked);
        xrButton.textContent = 'Enter AR';
        xrButton.disabled = false;

        await initWebGPU();
        requestAnimationFrame(onFrame);
      }

      // Initializes WebGPU resources
      async function initWebGPU() {
        if (!gpuDevice) {
          // Create a WebGPU adapter and device to render with, initialized to be
          // compatible with the XRDisplay we're presenting to. Note that a canvas
          // is not necessary if we are only rendering to the XR device.
          const adapter = await navigator.gpu.requestAdapter({
            xrCompatible: true
          });
          gpuDevice = await adapter.requestDevice();
          colorFormat = navigator.gpu.getPreferredCanvasFormat();

          gpuContext = webgpu_canvas.getContext('webgpu');
          gpuContext.configure({
            format: colorFormat,
            device: gpuDevice,
          });

          // A depth texture to use when not in an immersive session.
          gpuDepthTexture = gpuDevice.createTexture({
            size: { width: webgpu_canvas.width, height: webgpu_canvas.height },
            format: depthStencilFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });

          // Allocate a uniform buffer with enough space for two uniforms per-view
          gpuUniformBuffer = gpuDevice.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT * UNIFORM_FLOATS_PER_VIEW * MAX_VIEWS,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });

          // Set the uniform buffer to contain valid matrices initially so
          // that we can see something.
          let mat = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
          ];
          gpuUniformArray.set(mat, 16);
          gpuUniformArray.set(mat, 32);

          perspectiveZO(mat, Math.PI * 0.5, webgpu_canvas.offsetWidth / webgpu_canvas.offsetHeight, 0.1);
          gpuUniformArray.set(mat, 0);

          gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, gpuUniformArray);

          // Create a bind group layout for the uniforms
          gpuBindGroupLayout = gpuDevice.createBindGroupLayout({
            entries: [{
              binding: 0,
              visibility: GPUShaderStage.VERTEX,
              buffer: {},
            }]
          });

          // Create a bind group for each potential view
          for (let i = 0; i < MAX_VIEWS; ++i) {
            gpuBindGroups.push(gpuDevice.createBindGroup({
              layout: gpuBindGroupLayout,
              entries: [{
                binding: 0,
                resource: {
                  buffer: gpuUniformBuffer,
                  offset: Float32Array.BYTES_PER_ELEMENT * UNIFORM_FLOATS_PER_VIEW * i
                }
              }]
            }));
          }

          gpuModule = gpuDevice.createShaderModule({ code: SHADER_SRC });
        }

        gpuPipeline = gpuDevice.createRenderPipeline({
          layout: gpuDevice.createPipelineLayout({ bindGroupLayouts: [ gpuBindGroupLayout ]}),
          vertex: {
            module: gpuModule,
            entryPoint: 'vertexMain',
          },
          depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true,
            depthCompare: 'less-equal',
          },
          fragment: {
            module: gpuModule,
            entryPoint: 'fragmentMain',
            targets: [{
              format: colorFormat,
            }]
          }
        });
      }

      // Called when the user clicks the button to enter XR. If we don't have a
      // session we'll request one, and if we do have a session we'll end it.
      async function onButtonClicked() {
        if (!xrSession) {
          navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['webgpu'],
          }).then(onSessionStarted);
        } else {
          xrSession.end();
        }
      }

      // Called when we've successfully acquired a XRSession. In response we
      // will set up the necessary session state and kick off the frame loop.
      async function onSessionStarted(session) {
        xrSession = session;
        xrButton.textContent = 'Exit AR';

        // Listen for the sessions 'end' event so we can respond if the user
        // or UA ends the session for any reason.
        session.addEventListener('end', onSessionEnded);

        // Create the WebXR/WebGPU binding, and with it create a projection
        // layer to render to.
        xrGpuBinding = new XRGPUBinding(xrSession, gpuDevice);

        // If the preferred color format doesn't match what we've been rendering
        // with so far, rebuild the pipeline
        if (colorFormat != xrGpuBinding.getPreferredColorFormat()) {
          colorFormat = xrGpuBinding.getPreferredColorFormat();
          await initWebGPU();
        }

        projectionLayer = xrGpuBinding.createProjectionLayer({
          colorFormat,
          depthStencilFormat,
        });

        // Set the session's layers to display the projection layer. This allows
        // any content rendered to the layer to be displayed on the XR device.
        session.updateRenderState({ layers: [projectionLayer] });

        // Get a reference space, which is required for querying poses. In this
        // case an 'local' reference space means that all poses will be relative
        // to the location where the XR device was first detected.
        session.requestReferenceSpace('local').then(async (refSpace) => {
          xrRefSpace = refSpace;
          try {
            const viewer = await session.requestReferenceSpace('viewer');
            if (session.requestHitTestSource) {
              window.__viewerHit = await session.requestHitTestSource({ space: viewer });
            }
            if (session.requestHitTestSourceForTransientInput) {
              window.__transientHit = await session.requestHitTestSourceForTransientInput({ profile: 'generic-touchscreen' });
            }
          } catch {}

          // Inform the session that we're ready to begin drawing.
          session.requestAnimationFrame(onXRFrame);
        });
      }

      // Called either when the user has explicitly ended the session by calling
      // session.end() or when the UA has ended the session for any reason.
      // At this point the session object is no longer usable and should be
      // discarded.
      async function onSessionEnded(event) {
        xrSession = null;
        xrGpuBinding = null;
        xrButton.textContent = 'Enter AR';

        // If the canvas color format is different than the XR one, rebuild the
        // pipeline again upon switching back.
        if (colorFormat != navigator.gpu.getPreferredCanvasFormat()) {
          colorFormat = navigator.gpu.getPreferredCanvasFormat();
          await initWebGPU();
        }

        requestAnimationFrame(onFrame);
      }

      // Called every time the XRSession requests that a new frame be drawn.
      function onXRFrame(time, frame) {
        let session = frame.session;

        // Inform the session that we're ready for the next frame.
        session.requestAnimationFrame(onXRFrame);

        // Get the XRDevice pose relative to the reference space we created
        // earlier.
        let pose = frame.getViewerPose(xrRefSpace);

        // Getting the pose may fail if, for example, tracking is lost. So we
        // have to check to make sure that we got a valid pose before attempting
        // to render with it. If not in this case we'll just leave the
        // framebuffer cleared, so tracking loss means the scene will simply
        // disappear.
        if (pose) {
          // Update hits (viewer + transient)
          try {
            if (window.__viewerHit) {
              const hits = frame.getHitTestResults(window.__viewerHit);
              if (hits && hits.length > 0) {
                window.__lastViewerPose = hits[0].getPose(xrRefSpace);
              }
            }
            if (window.__transientHit && frame.getHitTestResultsForTransientInput) {
              const tr = frame.getHitTestResultsForTransientInput(window.__transientHit);
              if (tr && tr.length > 0 && tr[0].results && tr[0].results.length > 0) {
                window.__lastTransient = tr[0].results[0];
              }
            }
          } catch {}

          // If we do have a valid pose, begin recording GPU commands.
          const commandEncoder = gpuDevice.createCommandEncoder();

          // First loop through each view and write it's projection and view
          // matrices into the uniform buffer.
          for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
            const view = pose.views[viewIndex];
            const offset = UNIFORM_FLOATS_PER_VIEW * viewIndex;
            gpuUniformArray.set(view.projectionMatrix, offset);
            gpuUniformArray.set(view.transform.inverse.matrix, offset + 16);
          }
          gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, gpuUniformArray);

          // Now loop through each of the views and draw into the corresponding
          // sub image of the projection layer.
          for (let viewIndex = 0; viewIndex < pose.views.length; ++viewIndex) {
            const view = pose.views[viewIndex];
            let subImage = xrGpuBinding.getViewSubImage(projectionLayer, view);

            // Start a render pass which uses the textures of the view's sub
            // image as render targets.
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                  view: subImage.colorTexture.createView(subImage.getViewDescriptor()),
                  // Clear the color texture to a solid color.
                  loadOp: 'clear',
                  storeOp: 'store',
                  // Clear the canvas to transparent black so the user's environment
                  // shows through.
                  clearValue: [0.0, 0.0, 0.0, 0.0],
                }],
                depthStencilAttachment: {
                  view: subImage.depthStencilTexture.createView(subImage.getViewDescriptor()),
                  // Clear the depth texture
                  depthLoadOp: 'clear',
                  depthStoreOp: 'store',
                  depthClearValue: 1.0,
                }
              });

            let vp = subImage.viewport;
            renderPass.setViewport(vp.x, vp.y, vp.width, vp.height, 0.0, 1.0);

            // Draw triangle at viewer-hit pose if available
            if (window.__lastViewerPose) {
              const mo = UNIFORM_FLOATS_PER_VIEW * viewIndex + 32;
              gpuUniformArray.set(window.__lastViewerPose.transform.matrix, mo);
              gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, gpuUniformArray);
              drawScene(renderPass, viewIndex);
            } else {
              // fallback at default model (identity)
              drawScene(renderPass, viewIndex);
            }

            renderPass.end();
          }

          // FPS overlay
          {
            const now = performance.now();
            window.__frames = (window.__frames || 0) + 1;
            if (!window.__fps_t0) window.__fps_t0 = now;
            const dt = now - window.__fps_t0;
            if (dt >= 500) {
              const fps = Math.round((window.__frames * 1000) / dt);
              const el = document.getElementById('fps');
              if (el) el.textContent = 'FPS: ' + fps;
              window.__frames = 0;
              window.__fps_t0 = now;
            }
          }

          // Submit the rendering commands to the GPU.
          gpuDevice.queue.submit([commandEncoder.finish()]);
        }
      }

      // Does a standard render to the canvas
      function onFrame(time) {
        // If a session has started since the last frame don't request a new one.
        if (!xrSession) {
          requestAnimationFrame(onFrame);
        }

        const commandEncoder = gpuDevice.createCommandEncoder();

        // Start a render pass which uses the textures of the view's sub
        // image as render targets.
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: gpuContext.getCurrentTexture().createView(),
            // Clear the color texture to a solid color.
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0.1, 0.1, 0.4, 1.0],
          }],
          depthStencilAttachment: {
            view: gpuDepthTexture.createView(),
            // Clear the depth texture
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
          }
        });

        drawScene(renderPass);

        renderPass.end();

        // Submit the rendering commands to the GPU.
        gpuDevice.queue.submit([commandEncoder.finish()]);
      }

      function drawScene(renderPass, viewIndex = 0) {
        // Renders the scene using the uniforms saved for view[viewIndex], which
        // are accessible in gpuBindGroups[viewIndex].
        renderPass.setPipeline(gpuPipeline);
        renderPass.setBindGroup(0, gpuBindGroups[viewIndex]);
        // Draw many instances to stress performance
        renderPass.draw(3, 1024);
      }

      // Start the XR application.
      initXR();