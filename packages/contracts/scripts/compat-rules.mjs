/**
 * OpenAPI 破坏性变更检测规则（评审 B4）。
 *
 * 契约层此前只有"漂移检查"（committed == 后端当前输出），它只能保证**仓库内一致**，
 * 不能回答"这次改契约会不会把老前端/老调用方弄坏"。本文件提供一个**无需第三方
 * 依赖**的差量规则集，对比"上一版基线与当前契约"，只报告会影响调用方的变更。
 *
 * 规则的口径（都从"调用方视角"出发）：
 *   破坏（breaking）→ 老调用方会编译失败 / 行为出错 / 少拿到数据
 *   提醒（warning） → 语义变化但向后兼容，或无法静态判定
 *
 * 基线的维护方式：**每个正式版本发版时**执行 `pnpm contracts:baseline` 把当时的
 * 契约快照为基线；日常 PR 的 `pnpm contracts:compat` 只做比较，不改基线。
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** 解析本地 `$ref`（`#/components/schemas/X` 这类），解析失败原样返回。 */
export function resolveRef(spec, node, depth = 0) {
  if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
  if (depth > 20 || !node.$ref.startsWith('#/')) return node;

  const segments = node.$ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let target = spec;
  for (const segment of segments) {
    if (!target || typeof target !== 'object') return node;
    target = target[segment];
  }
  return target ?? node;
}

/** 把 `anyOf: [X, {type: null}]` 归一成 `{schema: X, nullable: true}`。 */
function unwrapNullable(spec, node) {
  const resolved = resolveRef(spec, node);
  const variants = resolved?.anyOf ?? resolved?.oneOf;
  if (Array.isArray(variants) && variants.length === 2) {
    const objects = variants.filter((v) => resolveRef(spec, v)?.type !== 'null');
    const nulls = variants.filter((v) => resolveRef(spec, v)?.type === 'null');
    if (objects.length === 1 && nulls.length === 1) {
      return { schema: resolveRef(spec, objects[0]), nullable: true };
    }
  }
  return { schema: resolved, nullable: false };
}

/** 结构签名：用于快速判断"类型是否变了"。 */
export function schemaSignature(spec, node, depth = 0) {
  const { schema, nullable } = unwrapNullable(spec, node);
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (depth > 10) return 'deep';

  const suffix = nullable ? '|null' : '';
  if (schema.type) {
    if (schema.type === 'array') return `array<${schemaSignature(spec, schema.items, depth + 1)}>${suffix}`;
    return `${schema.type}${suffix}`;
  }
  if (schema.properties) return `object${suffix}`;
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.join('|')})${suffix}`;
  return `any${suffix}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 对比两份 OpenAPI 文档，返回 `{ breaking, warnings }`，每条都带定位路径。
 *
 * @param {any} baseline 上一版契约（JSON 形态，由 YAML 转换而来）
 * @param {any} current  当前契约
 */
export function findBreakingChanges(baseline, current) {
  const breaking = [];
  const warnings = [];
  const report = (list, path, message) => list.push({ path, message });

  comparePaths();
  return { breaking, warnings };

  function comparePaths() {
    const basePaths = baseline?.paths ?? {};
    const currentPaths = current?.paths ?? {};

    for (const [route, basePathItem] of Object.entries(basePaths)) {
      const currentPathItem = currentPaths[route];
      if (!currentPathItem) {
        report(breaking, route, '接口路径被移除');
        continue;
      }

      for (const method of METHODS) {
        const baseOperation = basePathItem?.[method];
        if (!baseOperation) continue;
        const operation = currentPathItem?.[method];
        const where = `${method.toUpperCase()} ${route}`;

        if (!operation) {
          report(breaking, where, '接口方法被移除');
          continue;
        }
        compareOperation(where, baseOperation, operation);
      }
    }

    for (const [route, currentPathItem] of Object.entries(currentPaths)) {
      if (basePaths[route]) continue;
      for (const method of METHODS) {
        if (currentPathItem?.[method]) {
          report(warnings, `${method.toUpperCase()} ${route}`, '新增接口（向后兼容）');
        }
      }
    }
  }

  function compareOperation(where, baseOperation, operation) {
    if (baseOperation.operationId !== operation.operationId) {
      report(
        breaking,
        where,
        `operationId 变化（${baseOperation.operationId} → ${operation.operationId}）会让生成客户端的方法名全变`,
      );
    }

    compareParameters(where, baseOperation.parameters, operation.parameters);

    const baseBody = baseOperation.requestBody;
    const body = operation.requestBody;
    if (baseBody && !body) {
      report(breaking, `${where} body`, '请求体被移除');
    } else if (!baseBody && body?.required) {
      report(breaking, `${where} body`, '新增必填请求体');
    } else if (baseBody && body) {
      compareSchema(
        pickJsonSchema(baseline, baseBody),
        pickJsonSchema(current, body),
        `${where} body`,
        'request',
      );
    }

    const baseResponses = baseOperation.responses ?? {};
    const responses = operation.responses ?? {};
    for (const [code, baseResponse] of Object.entries(baseResponses)) {
      const response = responses[code];
      if (!response) {
        report(/^2/.test(code) ? breaking : warnings, `${where} ${code}`, '响应状态码被移除');
        continue;
      }
      const baseSchema = pickJsonSchema(baseline, baseResponse);
      const schema = pickJsonSchema(current, response);
      if (baseSchema && schema) compareSchema(baseSchema, schema, `${where} ${code}`, 'response');
      else if (baseSchema && !schema) {
        report(breaking, `${where} ${code}`, '响应体 schema 被移除');
      }
    }
  }

  function compareParameters(where, baseParameters, parameters) {
    const index = (list) => {
      const map = new Map();
      for (const parameter of asArray(list)) map.set(`${parameter.in}:${parameter.name}`, parameter);
      return map;
    };
    const baseMap = index(baseParameters);
    const currentMap = index(parameters);

    for (const [key, baseParameter] of baseMap) {
      const parameter = currentMap.get(key);
      if (!parameter) {
        report(breaking, `${where} ${key}`, '参数被移除');
        continue;
      }
      if (baseParameter.required && !parameter.required) {
        report(
          breaking,
          `${where} ${key}`,
          parameter.in === 'path' ? '路径参数不再 required' : '参数由必填变为可选',
        );
      }
      compareSchema(baseParameter.schema, parameter.schema, `${where} ${key}`, 'request');
    }

    for (const [key, parameter] of currentMap) {
      if (baseMap.has(key)) continue;
      if (parameter.required) {
        report(breaking, `${where} ${key}`, '新增必填参数（老调用方不会传）');
      } else {
        report(warnings, `${where} ${key}`, '新增可选参数（向后兼容）');
      }
    }
  }

  function compareSchema(rawBase, rawCurrent, where, kind) {
    if (!rawBase || !rawCurrent) return;

    const base = unwrapNullable(baseline, rawBase);
    const currentSchema = unwrapNullable(current, rawCurrent);
    const baseSignature = schemaSignature(baseline, base.schema);
    const currentSignature = schemaSignature(current, currentSchema.schema);

    if (baseSignature !== currentSignature) {
      report(
        breaking,
        where,
        `类型变化：${baseSignature} → ${currentSignature}`,
      );
      return;
    }

    if (base.nullable !== currentSchema.nullable) {
      report(
        currentSchema.nullable ? warnings : breaking,
        where,
        currentSchema.nullable ? '可空性放宽' : '字段由可空变为必填',
      );
    }

    const baseSchema = base.schema ?? {};
    const schema = currentSchema.schema ?? {};

    compareEnums(baseSchema, schema, where, kind);

    if (baseSchema.type === 'array' || schema.type === 'array') {
      compareSchema(baseSchema.items, schema.items, `${where}[]`, kind);
      return;
    }

    const baseProps = baseSchema.properties ?? {};
    const currentProps = schema.properties ?? {};
    const baseRequired = new Set(asArray(baseSchema.required));
    const currentRequired = new Set(asArray(schema.required));

    for (const [name, baseProperty] of Object.entries(baseProps)) {
      const property = currentProps[name];
      if (!property) {
        report(
          kind === 'response' ? breaking : warnings,
          `${where}.${name}`,
          kind === 'response' ? '响应字段被移除（调用方会少拿到数据）' : '请求字段被移除',
        );
        continue;
      }
      if (kind === 'request' && !baseRequired.has(name) && currentRequired.has(name)) {
        report(breaking, `${where}.${name}`, '请求字段由可选变为必填');
      }
      if (kind === 'response' && baseRequired.has(name) && !currentRequired.has(name)) {
        report(breaking, `${where}.${name}`, '响应字段由必填变为可选');
      }
      compareSchema(baseProperty, property, `${where}.${name}`, kind);
    }

    for (const [name, property] of Object.entries(currentProps)) {
      if (baseProps[name]) continue;
      if (currentRequired.has(name)) {
        report(
          breaking,
          `${where}.${name}`,
          kind === 'response' ? '响应新增必填字段（生成类型会变）' : '请求新增必填字段（老调用方不会传）',
        );
      } else {
        report(warnings, `${where}.${name}`, '新增可选字段（向后兼容）');
      }
    }
  }

  function compareEnums(baseSchema, schema, where, kind) {
    const baseEnum = asArray(baseSchema.enum);
    const currentEnum = asArray(schema.enum);
    if (!baseEnum.length && !currentEnum.length) return;

    if (!baseEnum.length || !currentEnum.length) {
      report(warnings, where, '枚举约束被新增/移除');
      return;
    }

    const baseSet = new Set(baseEnum);
    const currentSet = new Set(currentEnum);
    const removed = baseEnum.filter((value) => !currentSet.has(value));
    const added = currentEnum.filter((value) => !baseSet.has(value));

    if (removed.length) {
      report(
        breaking,
        where,
        kind === 'request'
          ? `请求枚举删除了取值：${removed.join(', ')}（老调用方可能仍在发送）`
          : `响应枚举删除了取值：${removed.join(', ')}`,
      );
    }
    if (added.length) {
      report(warnings, where, `枚举新增取值：${added.join(', ')}`);
    }
  }
}

/** 取请求/响应里的 `application/json` schema；没有就返回 null。 */
function pickJsonSchema(spec, container) {
  const content = container?.content;
  if (!content) return null;
  const media = content['application/json'] ?? Object.values(content)[0];
  return media?.schema ?? null;
}
