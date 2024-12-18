import { chalk, error, log, logJson } from '../../utils/command-helpers.js'
import {
  AVAILABLE_CONTEXTS,
  AVAILABLE_SCOPES,
  translateFromEnvelopeToMongo,
  isAPIEnvError,
} from '../../utils/env/index.js'
import type { Value } from '../api-types.js'
import BaseCommand from '../base-command.js'

import type { SetInEnvelopeParams, EnvSetOptions } from './types.d.ts'

/**
 * Updates the env for a site configured with Envelope with a new key/value pair
 * @returns {Promise<object | boolean>}
 */
// //@ts-expect-error TS(7031) FIXME: Binding element 'api' implicitly has an 'any' type... Remove this comment to see the full error message
const setInEnvelope = async ({ api, context, key, scope, secret, siteInfo, value }: SetInEnvelopeParams) => {
  const accountId = siteInfo.account_slug
  const siteId = siteInfo.id

  // secret values may not be used in the post-processing scope
  if (secret && scope && scope.some((sco) => /post[-_]processing/.test(sco))) {
    error(`Secret values cannot be used within the post-processing scope.`)
    return false
  }

  // secret values must specify deploy contexts. `all` or `dev` are not allowed
  if (secret && value && (!context || context.includes('dev'))) {
    error(
      `To set a secret environment variable value, please specify a non-development context with the \`--context\` flag.`,
    )
    return false
  }

  // fetch envelope env vars
  const envelopeVariables = await api.getEnvVars({ accountId, siteId })
  const contexts = context || ['all']
  let scopes = scope || AVAILABLE_SCOPES

  if (secret) {
    // post_processing (aka post-processing) scope is not allowed with secrets
    scopes = scopes.filter((sco) => !/post[-_]processing/.test(sco))
  }

  // if the passed context is unknown, it is actually a branch name
  let values: Value[] = contexts.map((ctx) =>
    AVAILABLE_CONTEXTS.includes(ctx) ? { context: ctx, value } : { context: 'branch', context_parameter: ctx, value },
  )

  const existing = envelopeVariables.find((envVar) => envVar.key === key)

  const params = { accountId, siteId, key }
  try {
    if (existing) {
      if (!value) {
        // eslint-disable-next-line prefer-destructuring
        values = existing.values
        if (!scope) {
          // eslint-disable-next-line prefer-destructuring
          scopes = existing.scopes
        }
      }
      if (context && scope) {
        error(
          'Setting the context and scope at the same time on an existing env var is not allowed. Run the set command separately for each update.',
        )
        return false
      }
      if (context) {
        // update individual value(s)
        await Promise.all(values.map((val) => api.setEnvVarValue({ ...params, body: val })))
      } else {
        // otherwise update whole env var
        if (secret) {
          scopes = scopes.filter((sco) => !/post[-_]processing/.test(sco))
          if (values.some((val) => val.context === 'all')) {
            log(`This secret's value will be empty in the dev context.`)
            log(`Run \`netlify env:set ${key} <value> --context dev\` to set a new value for the dev context.`)
            values = AVAILABLE_CONTEXTS.filter((ctx) => ctx !== 'all').map((ctx) => ({
              context: ctx,
              // empty out dev value so that secret is indeed secret
              value: ctx === 'dev' ? '' : values.find((val) => val.context === 'all')?.value ?? '',
            }))
          }
        }
        const body = { key, is_secret: secret, scopes, values }
        await api.updateEnvVar({ ...params, body })
      }
    } else {
      // create whole env var
      const body = [{ key, is_secret: secret, scopes, values }]
      await api.createEnvVars({ ...params, body })
    }
  } catch (error_) {
    const errortoThrow = isAPIEnvError(error_) ? error_.json.msg : error_
    throw errortoThrow
  }

  const env = translateFromEnvelopeToMongo(envelopeVariables, context ? context[0] : 'dev')
  return {
    ...env,
    [key]: value || env[key],
  }
}

export const envSet = async (key: string, value: string, options: EnvSetOptions, command: BaseCommand) => {
  const { context, scope, secret } = options

  const { api, cachedConfig, site } = command.netlify
  const siteId = site.id

  if (!siteId) {
    log('No site id found, please run inside a site folder or `netlify link`')
    return false
  }

  const { siteInfo } = cachedConfig

  // Get current environment variables set in the UI
  const finalEnv = await setInEnvelope({ api, siteInfo, key, value, context, scope, secret })

  if (!finalEnv) {
    return false
  }

  // Return new environment variables of site if using json flag
  if (options.json) {
    logJson(finalEnv)
    return false
  }

  const withScope = scope ? ` scoped to ${chalk.white(scope)}` : ''
  const withSecret = secret ? ` as a ${chalk.blue('secret')}` : ''
  const contextType = AVAILABLE_CONTEXTS.includes(context || 'all') ? 'context' : 'branch'
  log(
    `Set environment variable ${chalk.yellow(
      `${key}${value && !secret ? `=${value}` : ''}`,
    )}${withScope}${withSecret} in the ${chalk.magenta(context || 'all')} ${contextType}`,
  )
}
