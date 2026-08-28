import {
  ClientDefinition,
  FieldDefinition,
  RecordData,
  RuleDefinition,
  ValidationError,
  ValidationResult,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function findFieldDefinition(
  definition: ClientDefinition,
  fieldName: string | undefined
): FieldDefinition | undefined {
  if (!fieldName) return undefined;
  return definition.fields.find((field) => field.name === fieldName);
}

function hasFieldError(
  fieldErrors: Map<string, ValidationError[]>,
  fieldName: string | undefined
): boolean {
  if (!fieldName) return false;
  return (fieldErrors.get(fieldName)?.length ?? 0) > 0;
}

function evaluateCondition(
  record: RecordData,
  condition: RuleDefinition["type"] extends "required_if"
    ? NonNullable<Extract<RuleDefinition, { type: "required_if" }> ["when"]>
    : Record<string, unknown>
): boolean {
  const cond = condition as Record<string, unknown>;
  const dependencyField = String(cond.field ?? "");
  if (!dependencyField) return true;

  const value = record[dependencyField];
  if (isEmpty(value)) return false;

  const rawOp = String(cond.op ?? cond.operator ?? "");
  const equals = "equals" in cond ? cond.equals : undefined;
  const notEquals = "not_equals" in cond ? cond.not_equals : undefined;
  const expected = "value" in cond ? cond.value : equals;

  switch (rawOp || (equals !== undefined ? "equals" : notEquals !== undefined ? "not_equals" : "exists")) {
    case "exists":
      return !isEmpty(value);
    case "equals":
      return value === expected;
    case "not_equals":
      return value !== (notEquals ?? expected);
    case "in": {
      const list = Array.isArray(cond.value) ? cond.value : Array.isArray(cond.equals) ? cond.equals : [];
      return list.some((entry) => entry === value);
    }
    case "not_in": {
      const list = Array.isArray(cond.value) ? cond.value : Array.isArray(cond.equals) ? cond.equals : [];
      return !list.some((entry) => entry === value);
    }
    default:
      return value === expected;
  }
}

function resolveRuleReference(rule: RuleDefinition): string | undefined {
  const candidate = rule as Record<string, unknown>;
  return (
    (typeof candidate.compare_to === "string" && candidate.compare_to) ||
    (typeof candidate.other_field === "string" && candidate.other_field) ||
    (typeof candidate.against === "string" && candidate.against) ||
    (typeof candidate.on === "string" && candidate.on) ||
    undefined
  );
}

function compareValues(left: unknown, right: unknown, operator: string): boolean {
  const leftNumber = typeof left === "number" ? left : typeof left === "string" && left.trim() !== "" ? Number(left) : Number.NaN;
  const rightNumber = typeof right === "number" ? right : typeof right === "string" && right.trim() !== "" ? Number(right) : Number.NaN;
  const sharedNumeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);

  if (sharedNumeric) {
    switch (operator) {
      case "lt":
      case "before":
        return leftNumber < rightNumber;
      case "lte":
      case "not_after":
        return leftNumber <= rightNumber;
      case "gt":
      case "after":
        return leftNumber > rightNumber;
      case "gte":
      case "not_before":
        return leftNumber >= rightNumber;
      case "eq":
        return leftNumber === rightNumber;
      case "neq":
        return leftNumber !== rightNumber;
      default:
        return false;
    }
  }

  const leftIsDate = typeof left === "string" && DATE_RE.test(left);
  const rightIsDate = typeof right === "string" && DATE_RE.test(right);
  if (leftIsDate && rightIsDate) {
    const leftDate = new Date(`${left}T00:00:00Z`).getTime();
    const rightDate = new Date(`${right}T00:00:00Z`).getTime();
    switch (operator) {
      case "lt":
      case "before":
        return leftDate < rightDate;
      case "lte":
      case "not_after":
        return leftDate <= rightDate;
      case "gt":
      case "after":
        return leftDate > rightDate;
      case "gte":
      case "not_before":
        return leftDate >= rightDate;
      case "eq":
        return leftDate === rightDate;
      case "neq":
        return leftDate !== rightDate;
      default:
        return false;
    }
  }

  const leftValue = typeof left === "string" ? left : String(left);
  const rightValue = typeof right === "string" ? right : String(right);

  switch (operator) {
    case "lt":
      return leftValue < rightValue;
    case "lte":
      return leftValue <= rightValue;
    case "gt":
      return leftValue > rightValue;
    case "gte":
      return leftValue >= rightValue;
    case "eq":
      return leftValue === rightValue;
    case "neq":
      return leftValue !== rightValue;
    default:
      return false;
  }
}

function validateField(field: FieldDefinition, value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (message: string) => errors.push({ field: field.name, error: message });
  const c = field.constraints ?? {};

  if (isEmpty(value)) {
    if (field.required) err("This field is required");
    return errors;
  }

  switch (field.type) {
    case "text":
    case "long_text": {
      if (typeof value !== "string") {
        err("Must be a string");
        break;
      }
      if (c.min_length !== undefined && value.length < c.min_length)
        err(`Must be at least ${c.min_length} characters`);
      if (c.max_length !== undefined && value.length > c.max_length)
        err(`Must be at most ${c.max_length} characters`);
      if (c.pattern !== undefined && !new RegExp(c.pattern).test(value))
        err("Does not match the required format");
      break;
    }

    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        err("Must be a number");
        break;
      }
      if (c.min !== undefined && value < c.min) err(`Must be at least ${c.min}`);
      if (c.max !== undefined && value > c.max) err(`Must be at most ${c.max}`);
      break;
    }

    case "date": {
      if (typeof value !== "string" || !DATE_RE.test(value)) {
        err("Must be a date in YYYY-MM-DD format");
        break;
      }
      const parsed = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) err("Not a real calendar date");
      break;
    }

    case "boolean": {
      if (typeof value !== "boolean") err("Must be true or false");
      break;
    }

    case "choice": {
      if (typeof value !== "string" || !(field.options ?? []).includes(value))
        err(`Not an allowed value: ${String(value)}`);
      break;
    }

    case "multi_choice": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        err("Must be a list of values");
        break;
      }
      const options = field.options ?? [];
      const bad = value.filter((v) => !options.includes(v as string));
      if (bad.length > 0) err(`Not allowed values: ${bad.join(", ")}`);
      if (new Set(value).size !== value.length) err("Contains duplicate values");
      if (c.min_selected !== undefined && value.length < c.min_selected)
        err(`Select at least ${c.min_selected}`);
      if (c.max_selected !== undefined && value.length > c.max_selected)
        err(`Select at most ${c.max_selected}`);
      break;
    }

    case "file": {
      // A file value is its filename (upload handling lives elsewhere).
      if (typeof value !== "string") {
        err("Must be a filename");
        break;
      }
      const ext = value.includes(".") ? value.split(".").pop()!.toLowerCase() : "";
      if (c.accepted !== undefined && !c.accepted.includes(ext))
        err(`File type not accepted: .${ext || "?"}`);
      break;
    }
  }

  return errors;
}

/**
 * Validate one record against a client definition.
 * Returns an empty array when the record is valid.
 *
 * Unknown keys in the record (keys with no field definition) are reported
 * as errors: the engine fails closed on fields it does not recognise.
 */
export function validate(
  definition: ClientDefinition,
  record: RecordData
): ValidationResult {
  const errors: ValidationError[] = [];
  const fieldErrors = new Map<string, ValidationError[]>();

  for (const field of definition.fields) {
    const validationErrors = validateField(field, record[field.name]);
    fieldErrors.set(field.name, validationErrors);
    errors.push(...validationErrors);
  }

  const known = new Set(definition.fields.map((f) => f.name));
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      errors.push({ field: key, error: "Unknown field" });
    }
  }

  for (const rule of definition.rules ?? []) {
    const targetField = rule.field;
    const ruleRecord = rule as Record<string, unknown>;

    if (rule.type === "required_if") {
      const condition = ruleRecord.when as Record<string, unknown> | undefined;
      if (condition && !evaluateCondition(record, condition)) continue;
      if (!condition) {
        if (isEmpty(record[targetField])) {
          errors.push({ field: targetField, error: rule.message });
        }
        continue;
      }
      if (isEmpty(record[targetField])) {
        errors.push({ field: targetField, error: rule.message });
      }
      continue;
    }

    const dependencyField = resolveRuleReference(rule);
    if (!dependencyField) continue;
    if (isEmpty(record[targetField]) || isEmpty(record[dependencyField])) continue;
    if (hasFieldError(fieldErrors, targetField) || hasFieldError(fieldErrors, dependencyField)) continue;

    const operator = String(ruleRecord.operator ?? ruleRecord.op ?? "not_before");
    if (!compareValues(record[targetField], record[dependencyField], operator)) {
      errors.push({ field: targetField, error: rule.message });
    }
  }

  return errors;
}
