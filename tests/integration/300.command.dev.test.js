// Handlers are meant to be async outside tests
/* eslint-disable require-await */
const path = require('path')
const process = require('process')

// eslint-disable-next-line ava/use-test
const avaTest = require('ava')
const { isCI } = require('ci-info')

const { withDevServer } = require('./utils/dev-server')
const got = require('./utils/got')
const { withSiteBuilder } = require('./utils/site-builder')

const test = isCI ? avaTest.serial.bind(avaTest) : avaTest

const testMatrix = [
  { args: [] },

  // some tests are still failing with this enabled
  // { args: ['--edgeHandlers'] }
]

const testName = (title, args) => (args.length <= 0 ? title : `${title} - ${args.join(' ')}`)

testMatrix.forEach(({ args }) => {
  test(testName('should return index file when / is accessed', args), async (t) => {
    await withSiteBuilder('site-with-index-file', async (builder) => {
      builder.withContentFile({
        path: 'index.html',
        content: '<h1>⊂◉‿◉つ</h1>',
      })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(server.url).text()
        t.is(response, '<h1>⊂◉‿◉つ</h1>')
      })
    })
  })

  test(testName('should return user defined headers when / is accessed', args), async (t) => {
    await withSiteBuilder('site-with-headers-on-root', async (builder) => {
      builder.withContentFile({
        path: 'index.html',
        content: '<h1>⊂◉‿◉つ</h1>',
      })

      const headerName = 'X-Frame-Options'
      const headerValue = 'SAMEORIGIN'
      builder.withHeadersFile({ headers: [{ path: '/*', headers: [`${headerName}: ${headerValue}`] }] })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const { headers } = await got(server.url)
        t.is(headers[headerName.toLowerCase()], headerValue)
      })
    })
  })

  test(testName('should return user defined headers when non-root path is accessed', args), async (t) => {
    await withSiteBuilder('site-with-headers-on-non-root', async (builder) => {
      builder.withContentFile({
        path: 'foo/index.html',
        content: '<h1>⊂◉‿◉つ</h1>',
      })

      const headerName = 'X-Frame-Options'
      const headerValue = 'SAMEORIGIN'
      builder.withHeadersFile({ headers: [{ path: '/*', headers: [`${headerName}: ${headerValue}`] }] })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const { headers } = await got(`${server.url}/foo`)
        t.is(headers[headerName.toLowerCase()], headerValue)
      })
    })
  })

  test(testName('should return response from a function with setTimeout', args), async (t) => {
    await withSiteBuilder('site-with-set-timeout-function', async (builder) => {
      builder.withNetlifyToml({ config: { functions: { directory: 'functions' } } }).withFunction({
        path: 'timeout.js',
        handler: async () => {
          console.log('ding')
          // Wait for 4 seconds
          const FUNCTION_TIMEOUT = 4e3
          await new Promise((resolve) => {
            setTimeout(resolve, FUNCTION_TIMEOUT)
          })
          return {
            statusCode: 200,
            body: 'ping',
            metadata: { builder_function: true },
          }
        },
      })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/timeout`).text()
        t.is(response, 'ping')
        const builderResponse = await got(`${server.url}/.netlify/builders/timeout`).text()
        t.is(builderResponse, 'ping')
      })
    })
  })

  test(testName('should fail when no metadata is set for builder function', args), async (t) => {
    await withSiteBuilder('site-with-misconfigured-builder-function', async (builder) => {
      builder.withNetlifyToml({ config: { functions: { directory: 'functions' } } }).withFunction({
        path: 'builder.js',
        handler: async () => ({
          statusCode: 200,
          body: 'ping',
        }),
      })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/builder`)
        t.is(response.body, 'ping')
        t.is(response.statusCode, 200)
        const builderResponse = await got(`${server.url}/.netlify/builders/builder`, {
          throwHttpErrors: false,
        })
        t.is(
          builderResponse.body,
          `{"message":"Function is not an on-demand builder. See https://ntl.fyi/create-builder for how to convert a function to a builder."}`,
        )
        t.is(builderResponse.statusCode, 400)
      })
    })
  })

  test(testName('should serve function from a subdirectory', args), async (t) => {
    await withSiteBuilder('site-with-from-subdirectory', async (builder) => {
      builder.withNetlifyToml({ config: { functions: { directory: 'functions' } } }).withFunction({
        path: path.join('echo', 'echo.js'),
        handler: async () => ({
          statusCode: 200,
          body: 'ping',
          metadata: { builder_function: true },
        }),
      })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/echo`).text()
        t.is(response, 'ping')
        const builderResponse = await got(`${server.url}/.netlify/builders/echo`).text()
        t.is(builderResponse, 'ping')
      })
    })
  })

  test(testName('should pass .env.development vars to function', args), async (t) => {
    await withSiteBuilder('site-with-env-development', async (builder) => {
      builder
        .withNetlifyToml({ config: { functions: { directory: 'functions' } } })
        .withEnvFile({ path: '.env.development', env: { TEST: 'FROM_DEV_FILE' } })
        .withFunction({
          path: 'env.js',
          handler: async () => ({
            statusCode: 200,
            body: `${process.env.TEST}`,
            metadata: { builder_function: true },
          }),
        })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/env`).text()
        t.is(response, 'FROM_DEV_FILE')
        const builderResponse = await got(`${server.url}/.netlify/builders/env`).text()
        t.is(builderResponse, 'FROM_DEV_FILE')
      })
    })
  })

  test(testName('should pass process env vars to function', args), async (t) => {
    await withSiteBuilder('site-with-process-env', async (builder) => {
      builder.withNetlifyToml({ config: { functions: { directory: 'functions' } } }).withFunction({
        path: 'env.js',
        handler: async () => ({
          statusCode: 200,
          body: `${process.env.TEST}`,
          metadata: { builder_function: true },
        }),
      })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, env: { TEST: 'FROM_PROCESS_ENV' }, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/env`).text()
        t.is(response, 'FROM_PROCESS_ENV')
        const builderResponse = await got(`${server.url}/.netlify/builders/env`).text()
        t.is(builderResponse, 'FROM_PROCESS_ENV')
      })
    })
  })

  test(testName('should pass [build.environment] env vars to function', args), async (t) => {
    await withSiteBuilder('site-with-build-environment', async (builder) => {
      builder
        .withNetlifyToml({
          config: { build: { environment: { TEST: 'FROM_CONFIG_FILE' } }, functions: { directory: 'functions' } },
        })
        .withFunction({
          path: 'env.js',
          handler: async () => ({
            statusCode: 200,
            body: `${process.env.TEST}`,
            metadata: { builder_function: true },
          }),
        })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/env`).text()
        t.is(response, 'FROM_CONFIG_FILE')
        const builderResponse = await got(`${server.url}/.netlify/builders/env`).text()
        t.is(builderResponse, 'FROM_CONFIG_FILE')
      })
    })
  })

  test(testName('[context.dev.environment] should override [build.environment]', args), async (t) => {
    await withSiteBuilder('site-with-build-environment', async (builder) => {
      builder
        .withNetlifyToml({
          config: {
            build: { environment: { TEST: 'DEFAULT_CONTEXT' } },
            context: { dev: { environment: { TEST: 'DEV_CONTEXT' } } },
            functions: { directory: 'functions' },
          },
        })
        .withFunction({
          path: 'env.js',
          handler: async () => ({
            statusCode: 200,
            body: `${process.env.TEST}`,
          }),
        })

      await builder.buildAsync()

      await withDevServer({ cwd: builder.directory, args }, async (server) => {
        const response = await got(`${server.url}/.netlify/functions/env`).text()
        t.is(response, 'DEV_CONTEXT')
      })
    })
  })
})
/* eslint-enable require-await */