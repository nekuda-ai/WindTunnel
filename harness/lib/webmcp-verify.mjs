#!/usr/bin/env node

import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const ANNOTATION_KEYS = new Set(['readOnly', 'untrustedContent', 'autosubmit']);
const SIMPLE_STRING_KEYWORDS = [
  '$anchor', '$comment', '$dynamicAnchor', '$dynamicRef', '$id', '$ref', '$schema',
  'contentEncoding', 'contentMediaType', 'description', 'format', 'pattern', 'title'
];
const NON_NEGATIVE_INTEGER_KEYWORDS = [
  'maxContains', 'maxItems', 'maxLength', 'maxProperties', 'minContains', 'minItems',
  'minLength', 'minProperties'
];
const NUMBER_KEYWORDS = ['exclusiveMaximum', 'exclusiveMinimum', 'maximum', 'minimum'];
const SCHEMA_KEYWORDS = [
  'additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else', 'if',
  'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties'
];
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_MAP_KEYWORDS = [
  '$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties'
];
const JSON_TYPES = new Set([
  'array', 'boolean', 'integer', 'null', 'number', 'object', 'string'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSchema(value) {
  return typeof value === 'boolean' || isObject(value);
}

function push(errors, path, message) {
  errors.push({path, message});
}

function validateStringArray(value, path, errors, {unique = false, nonempty = false} = {}) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    push(errors, path, 'must be an array of strings');
    return;
  }
  if (nonempty && value.length === 0) push(errors, path, 'must not be empty');
  if (unique && new Set(value).size !== value.length) push(errors, path, 'must contain unique strings');
}

export function validateJsonSchema(schema, path = '$', errors = []) {
  if (typeof schema === 'boolean') return errors;
  if (!isObject(schema)) {
    push(errors, path, 'must be a JSON Schema object or boolean');
    return errors;
  }

  for (const keyword of SIMPLE_STRING_KEYWORDS) {
    if (keyword in schema && typeof schema[keyword] !== 'string') {
      push(errors, `${path}.${keyword}`, 'must be a string');
    }
  }
  if (typeof schema.pattern === 'string') {
    try {
      new RegExp(schema.pattern);
    } catch (error) {
      push(errors, `${path}.pattern`, `must be a valid regular expression: ${error.message}`);
    }
  }

  for (const keyword of NON_NEGATIVE_INTEGER_KEYWORDS) {
    if (keyword in schema && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      push(errors, `${path}.${keyword}`, 'must be a non-negative integer');
    }
  }
  for (const keyword of NUMBER_KEYWORDS) {
    if (keyword in schema && (typeof schema[keyword] !== 'number' || !Number.isFinite(schema[keyword]))) {
      push(errors, `${path}.${keyword}`, 'must be a finite number');
    }
  }
  if ('multipleOf' in schema &&
      (typeof schema.multipleOf !== 'number' || !Number.isFinite(schema.multipleOf) || schema.multipleOf <= 0)) {
    push(errors, `${path}.multipleOf`, 'must be a positive finite number');
  }

  for (const keyword of ['readOnly', 'writeOnly', 'uniqueItems', 'deprecated']) {
    if (keyword in schema && typeof schema[keyword] !== 'boolean') {
      push(errors, `${path}.${keyword}`, 'must be a boolean');
    }
  }

  if ('type' in schema) {
    const value = schema.type;
    if (typeof value === 'string') {
      if (!JSON_TYPES.has(value)) push(errors, `${path}.type`, `unknown JSON type: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0 || value.some(item => typeof item !== 'string' || !JSON_TYPES.has(item))) {
        push(errors, `${path}.type`, 'must be a non-empty array of JSON type names');
      } else if (new Set(value).size !== value.length) {
        push(errors, `${path}.type`, 'must contain unique JSON type names');
      }
    } else {
      push(errors, `${path}.type`, 'must be a JSON type name or array of JSON type names');
    }
  }

  if ('enum' in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    push(errors, `${path}.enum`, 'must be a non-empty array');
  } else if (Array.isArray(schema.enum)) {
    const values = schema.enum.map(value => JSON.stringify(value));
    if (new Set(values).size !== values.length) push(errors, `${path}.enum`, 'must contain unique JSON values');
  }
  if ('required' in schema) {
    validateStringArray(schema.required, `${path}.required`, errors, {unique: true});
  }

  if ('dependentRequired' in schema) {
    if (!isObject(schema.dependentRequired)) {
      push(errors, `${path}.dependentRequired`, 'must be an object');
    } else {
      for (const [key, value] of Object.entries(schema.dependentRequired)) {
        validateStringArray(value, `${path}.dependentRequired[${JSON.stringify(key)}]`, errors, {unique: true});
      }
    }
  }

  if ('$vocabulary' in schema) {
    if (!isObject(schema.$vocabulary) || Object.values(schema.$vocabulary).some(value => typeof value !== 'boolean')) {
      push(errors, `${path}.$vocabulary`, 'must be an object whose values are booleans');
    }
  }

  for (const keyword of SCHEMA_KEYWORDS) {
    if (!(keyword in schema)) continue;
    if (!isSchema(schema[keyword])) {
      push(errors, `${path}.${keyword}`, 'must be a JSON Schema object or boolean');
    } else {
      validateJsonSchema(schema[keyword], `${path}.${keyword}`, errors);
    }
  }

  if ('items' in schema) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((item, index) => {
        if (!isSchema(item)) push(errors, `${path}.items[${index}]`, 'must be a JSON Schema object or boolean');
        else validateJsonSchema(item, `${path}.items[${index}]`, errors);
      });
    } else if (!isSchema(schema.items)) {
      push(errors, `${path}.items`, 'must be a JSON Schema object, boolean, or schema array');
    } else {
      validateJsonSchema(schema.items, `${path}.items`, errors);
    }
  }

  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    if (!(keyword in schema)) continue;
    const value = schema[keyword];
    if (!Array.isArray(value) || (keyword !== 'prefixItems' && value.length === 0)) {
      push(errors, `${path}.${keyword}`, `must be ${keyword === 'prefixItems' ? 'an array' : 'a non-empty array'} of schemas`);
      continue;
    }
    value.forEach((item, index) => {
      if (!isSchema(item)) push(errors, `${path}.${keyword}[${index}]`, 'must be a JSON Schema object or boolean');
      else validateJsonSchema(item, `${path}.${keyword}[${index}]`, errors);
    });
  }

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (!(keyword in schema)) continue;
    const value = schema[keyword];
    if (!isObject(value)) {
      push(errors, `${path}.${keyword}`, 'must be an object whose values are schemas');
      continue;
    }
    for (const [key, item] of Object.entries(value)) {
      if (keyword === 'patternProperties') {
        try {
          new RegExp(key);
        } catch (error) {
          push(errors, `${path}.${keyword}[${JSON.stringify(key)}]`, `property name must be a valid regular expression: ${error.message}`);
        }
      }
      if (!isSchema(item)) push(errors, `${path}.${keyword}[${JSON.stringify(key)}]`, 'must be a JSON Schema object or boolean');
      else validateJsonSchema(item, `${path}.${keyword}[${JSON.stringify(key)}]`, errors);
    }
  }

  return errors;
}

export function validateTools(document) {
  const errors = [];
  const tools = document?.webmcpTools;
  if (!Array.isArray(tools)) {
    push(errors, '$.webmcpTools', 'must be an array');
    return {valid: false, shapeOnly: false, nativeRuntimeAccepted: true, errors};
  }

  const names = new Set();
  tools.forEach((tool, index) => {
    const path = `$.webmcpTools[${index}]`;
    if (!isObject(tool)) {
      push(errors, path, 'must be an object');
      return;
    }
    if (typeof tool.name !== 'string' || tool.name.trim() === '') {
      push(errors, `${path}.name`, 'must be a non-empty string');
    } else if (names.has(tool.name)) {
      push(errors, `${path}.name`, `duplicate runtime tool name: ${tool.name}`);
    } else {
      names.add(tool.name);
    }
    if (typeof tool.description !== 'string' || tool.description.trim() === '') {
      push(errors, `${path}.description`, 'must be a non-empty string');
    }
    if ('inputSchema' in tool && tool.inputSchema != null) {
      if (!isObject(tool.inputSchema)) {
        push(errors, `${path}.inputSchema`, 'must be a JSON Schema object');
      } else {
        validateJsonSchema(tool.inputSchema, `${path}.inputSchema`, errors);
        const rootType = tool.inputSchema.type;
        if (rootType !== undefined && rootType !== 'object' &&
            !(Array.isArray(rootType) && rootType.includes('object'))) {
          push(errors, `${path}.inputSchema.type`, 'must allow an object because WebMCP invocation input is an object');
        }
      }
    }
    if ('annotations' in tool && tool.annotations != null) {
      if (!isObject(tool.annotations)) {
        push(errors, `${path}.annotations`, 'must be an object');
      } else {
        for (const [key, value] of Object.entries(tool.annotations)) {
          if (!ANNOTATION_KEYS.has(key)) push(errors, `${path}.annotations.${key}`, 'is not a supported runtime annotation');
          if (typeof value !== 'boolean') push(errors, `${path}.annotations.${key}`, 'must be a boolean');
        }
      }
    }
  });

  return {
    valid: errors.length === 0,
    shapeOnly: false,
    nativeRuntimeAccepted: true,
    schemaDialect: 'WebMCP JSON Schema keyword validation',
    errors
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function compilePatterns(patterns, kind, errors) {
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string')) {
    push(errors, `$.${kind}`, 'must be an array of regular-expression strings');
    return [];
  }
  return patterns.flatMap((pattern, index) => {
    try {
      return [new RegExp(pattern)];
    } catch (error) {
      push(errors, `$.${kind}[${index}]`, `invalid regular expression: ${error.message}`);
      return [];
    }
  });
}

function items(document, key) {
  return Array.isArray(document?.[key]) ? document[key] : [];
}

function requestFailed(request) {
  const status = String(request?.status ?? '');
  if (/^\d+$/.test(status)) return Number(status) >= 400;
  return status !== '' && status !== 'pending';
}

function sameOrigin(url, expectedOrigin) {
  try {
    return new URL(url).origin === expectedOrigin;
  } catch {
    return false;
  }
}

// Vite dependency-optimization URLs carry a per-build browserHash as a
// `?v=<hex>` (or `&v=<hex>`) query param. The app is rebuilt and force-recreated
// between clean-site baseline capture and post-liveness comparison, so Vite
// regenerates these hashes every run. Strip only that volatile token so a
// baseline-present error still cancels against its comparison twin. Nothing else
// is normalized: the module path, error text, line/column, and every other query
// param stay byte-significant, so a genuinely different error never collapses.
function normalizeVolatile(value) {
  return String(value ?? '').replace(/([?&]v=)[0-9a-fA-F]+/g, '$1<hash>');
}

export function consoleFingerprint(message) {
  return JSON.stringify([
    message?.type ?? '',
    normalizeVolatile(message?.text ?? ''),
    normalizeVolatile(message?.url ?? ''),
    message?.lineNumber ?? '', message?.columnNumber ?? ''
  ]);
}

function networkFingerprint(request) {
  return JSON.stringify([
    request?.method ?? '', request?.url ?? '', String(request?.status ?? '')
  ]);
}

function subtractOccurrences(finalItems, baselineItems, key) {
  const remaining = new Map();
  for (const item of baselineItems) {
    const value = key(item);
    remaining.set(value, (remaining.get(value) ?? 0) + 1);
  }
  return finalItems.filter(item => {
    const value = key(item);
    const count = remaining.get(value) ?? 0;
    if (count === 0) return true;
    if (count === 1) remaining.delete(value);
    else remaining.set(value, count - 1);
    return false;
  });
}

export function evaluateRuntimeGate({
  url, baselineConsole, finalConsole, baselineNetwork, finalNetwork, allowlist = {}, comparison = 'id'
}) {
  const configErrors = [];
  let origin;
  try {
    origin = new URL(url).origin;
  } catch (error) {
    push(configErrors, '$.url', `invalid target URL: ${error.message}`);
  }
  if (!isObject(allowlist)) {
    push(configErrors, '$.allowlist', 'must be an object');
    allowlist = {};
  }
  if (comparison !== 'id' && comparison !== 'fingerprint') {
    push(configErrors, '$.comparison', 'must be "id" or "fingerprint"');
  }
  const consolePatterns = compilePatterns(allowlist.console ?? [], 'console', configErrors);
  const networkPatterns = compilePatterns(allowlist.network ?? [], 'network', configErrors);
  if (configErrors.length) return {valid: false, configurationValid: false, errors: configErrors};

  const consoleKey = comparison === 'id' ? message => String(message.id) : consoleFingerprint;
  const networkKey = comparison === 'id' ? request => String(request.requestId) : networkFingerprint;
  const newConsole = subtractOccurrences(
    items(finalConsole, 'consoleMessages'), items(baselineConsole, 'consoleMessages'), consoleKey
  );
  const newNetwork = subtractOccurrences(
    items(finalNetwork, 'networkRequests'), items(baselineNetwork, 'networkRequests'), networkKey
  );

  const consoleCandidates = newConsole.filter(message => message.type === 'error' || message.type === 'assert');
  const networkCandidates = newNetwork.filter(request => sameOrigin(request.url, origin) && requestFailed(request));
  const allowedConsoleFailures = consoleCandidates.filter(message => consolePatterns.some(pattern => pattern.test(message.text ?? '')));
  const allowedNetworkFailures = networkCandidates.filter(request => {
    const text = `${request.method ?? ''} ${request.url ?? ''} ${request.status ?? ''}`;
    return networkPatterns.some(pattern => pattern.test(text));
  });
  const consoleFailures = consoleCandidates.filter(message => !allowedConsoleFailures.includes(message));
  const networkFailures = networkCandidates.filter(request => !allowedNetworkFailures.includes(request));

  return {
    valid: consoleFailures.length === 0 && networkFailures.length === 0,
    configurationValid: true,
    comparison,
    targetOrigin: origin,
    newConsoleFailures: consoleFailures,
    newNetworkFailures: networkFailures,
    allowedConsoleFailures,
    allowedNetworkFailures,
    allowlist: {console: allowlist.console ?? [], network: allowlist.network ?? []}
  };
}

export function extractScriptResult(document) {
  if (!isObject(document) || typeof document.message !== 'string') {
    throw new Error('evaluate_script response has no message');
  }
  const match = document.message.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error('evaluate_script response has no JSON result block');
  return JSON.parse(match[1]);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate-tools' && args.length === 1) {
    const result = validateTools(readJson(args[0]));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  if (command === 'runtime-gate' && (args.length === 6 || args.length === 7)) {
    const [url, baselineConsoleFile, finalConsoleFile, baselineNetworkFile, finalNetworkFile, allowlistFile, comparison = 'id'] = args;
    const result = evaluateRuntimeGate({
      url,
      baselineConsole: readJson(baselineConsoleFile),
      finalConsole: readJson(finalConsoleFile),
      baselineNetwork: readJson(baselineNetworkFile),
      finalNetwork: readJson(finalNetworkFile),
      allowlist: allowlistFile === '-' ? {} : readJson(allowlistFile),
      comparison
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.valid ? 0 : result.configurationValid === false ? 2 : 3;
    return;
  }
  if (command === 'extract-script-result' && args.length === 1) {
    process.stdout.write(`${JSON.stringify(extractScriptResult(readJson(args[0])))}\n`);
    return;
  }
  process.stderr.write('usage: webmcp-verify.mjs validate-tools TOOLS_JSON | runtime-gate URL BASE_CONSOLE FINAL_CONSOLE BASE_NETWORK FINAL_NETWORK ALLOWLIST_JSON_OR_DASH [id|fingerprint] | extract-script-result EVALUATE_JSON\n');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
