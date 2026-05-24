export type {
  MockContext,
  MockResponse,
  MockDefinition,
  SoapMockDefinition,
  SoapContext,
  MockLogger,
  HttpMethod,
} from './types.js'

// ─── Core builder functions ────────────────────────────────────────────────────

import type { MockDefinition, SoapMockDefinition, MockResponse } from './types.js'

/**
 * Define a REST mock endpoint.
 *
 * @example
 * export default defineMock({
 *   method: 'GET',
 *   path: '/users/:id',
 *   async handler({ params }) {
 *     return ok({ id: params.id, name: 'Khang' })
 *   }
 * })
 */
export function defineMock(definition: MockDefinition): MockDefinition {
  return definition
}

/**
 * Define a SOAP mock endpoint.
 *
 * @example
 * export default defineSoapMock({
 *   operation: 'GetCustomer',
 *   async handler({ xml }) {
 *     return soapResponse(`<GetCustomerResponse><name>Khang</name></GetCustomerResponse>`)
 *   }
 * })
 */
export function defineSoapMock(definition: SoapMockDefinition): SoapMockDefinition {
  return definition
}

// ─── Response helpers ──────────────────────────────────────────────────────────

/** Return a 200 JSON response */
export function ok(body: unknown, status = 200): MockResponse {
  return { status, body }
}

/** Alias for ok() */
export const json = ok

/** Return an error response */
export function error(message: string, status = 400, extra?: Record<string, unknown>): MockResponse {
  return { status, body: { error: message, ...extra } }
}

/** Return an XML response */
export function xml(content: string, status = 200): MockResponse {
  return {
    status,
    body: content,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  }
}

/** Wrap a SOAP body fragment in a full SOAP 1.1 envelope */
export function soapResponse(bodyXml: string, version: '1.1' | '1.2' = '1.1'): MockResponse {
  const envelope =
    version === '1.2'
      ? `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>${bodyXml}</soap12:Body>
</soap12:Envelope>`
      : `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>${bodyXml}</soap:Body>
</soap:Envelope>`

  return {
    status: 200,
    body: envelope,
    headers: {
      'content-type':
        version === '1.2'
          ? 'application/soap+xml; charset=utf-8'
          : 'text/xml; charset=utf-8',
    },
  }
}

/** Return a SOAP fault */
export function soapFault(code: string, message: string, version: '1.1' | '1.2' = '1.1'): MockResponse {
  const body =
    version === '1.2'
      ? `<soap12:Fault><soap12:Code><soap12:Value>${code}</soap12:Value></soap12:Code><soap12:Reason><soap12:Text>${message}</soap12:Text></soap12:Reason></soap12:Fault>`
      : `<soap:Fault><faultcode>${code}</faultcode><faultstring>${message}</faultstring></soap:Fault>`
  return soapResponse(body, version)
}

/** Redirect to another URL */
export function redirect(url: string, status: 301 | 302 | 307 | 308 = 302): MockResponse {
  return { status, body: '', headers: { location: url } }
}

/** Introduce an artificial delay (milliseconds) */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Return a 404 not-found response */
export function notFound(message = 'Not found'): MockResponse {
  return error(message, 404)
}

/** Return a 401 unauthorized response */
export function unauthorized(message = 'Unauthorized'): MockResponse {
  return error(message, 401)
}

/** Return a 403 forbidden response */
export function forbidden(message = 'Forbidden'): MockResponse {
  return error(message, 403)
}

/** Return a 500 internal server error */
export function serverError(message = 'Internal server error'): MockResponse {
  return error(message, 500)
}

/** Return an empty 204 No Content response */
export function noContent(): MockResponse {
  return { status: 204, body: '' }
}

/** Return a response that simulates a random failure (for chaos testing) */
export function randomFailure(
  normalResponse: MockResponse,
  failureRate = 0.1,
  failureResponse?: MockResponse,
): MockResponse {
  if (Math.random() < failureRate) {
    return failureResponse ?? serverError('Simulated failure')
  }
  return normalResponse
}
