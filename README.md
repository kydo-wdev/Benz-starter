# Benoz.AI Take-Home: Platform Foundation Starter Package

This package contains a working, client-agnostic validation library and a passing
test suite. Your task is to extend it. Read this whole file before writing anything.

## What is here

```
lib/
  types.ts        The definition format: field types and constraints
  validator.ts    validate(definition, record) -> list of errors
definitions/
  client-1-fleet-service.json
  client-2-course-enrollment.json
  client-3-venue-booking.json
tests/
  validator.test.ts   The existing suite. All tests pass.
```

The library knows nothing about any client. Every client difference lives in a
definition file. `validate()` takes a definition and a record and returns a list
of `{ field, error }` objects, empty when the record is valid.

## Setup

```
npm install
npm test
```

All existing tests pass before you touch anything. Confirm that first.

## Your task

Extend the definition format and the library with three capabilities. The format
of each is yours to design; the design decisions are the point.

### a. Cross-field rules

A rule like "the end date must not be before the start date" must be declarable
as data in the definition file, not written as code.

### b. Conditional required

A rule like "field X is required only when field Y has value Z" must be
declarable the same way.

### c. Evaluation order

Define, document and implement what happens when a rule depends on a field that
is missing, or that has already failed its own validation. A user should see one
real error, not a cascade of nonsense.

## Document your design in this README

Under a new section, document precisely:

- How a rule refers to another field
- Which field an error is reported against, and why you chose that
- What happens when a dependency is missing, and when it is itself invalid
- Where you decided to stop: what your format deliberately cannot express

**After you submit, we will run your library against a definition file you have
not seen, for a client that does not appear in this package. It will contain
rules written against your design, following your README. If your README is
precise enough for us to write those rules correctly, and your code handles
them, you have done what the exercise asks.**

## Extended rule format

The definition can include a top-level `rules` array. Every rule is declarative
JSON and is evaluated by the validator at runtime; no client-specific logic is
hard-coded into `lib/`.

Example:

```json
{
  "fields": [
    { "name": "start_date", "type": "date", "required": true },
    { "name": "end_date", "type": "date", "required": true },
    { "name": "requires_approval", "type": "boolean", "required": false },
    { "name": "approver", "type": "text", "required": false }
  ],
  "rules": [
    {
      "type": "compare",
      "field": "end_date",
      "compare_to": "start_date",
      "operator": "not_before",
      "message": "End date must not be before the start date"
    },
    {
      "type": "required_if",
      "field": "approver",
      "when": { "field": "requires_approval", "equals": true },
      "message": "Approver is required when approval is required"
    }
  ]
}
```

### How a rule refers to another field

A rule names the field it is validating in `field`. For a cross-field check, it
then names the other field explicitly with a string property such as
`compare_to`, `other_field`, or `against`.

For conditional required fields, the rule uses `when` to say "evaluate this
field only when some other field has a certain value". The condition itself is a
small object of the form:

```json
{ "field": "requires_approval", "equals": true }
```

We intentionally keep the dependency reference as a plain field name string so
that definitions remain data-only and client-agnostic.

### Which field an error is reported against

The validator reports the error on the rule's `field`, not on the dependency
field. This matches the UX principle that the user should fix the field they
are currently looking at. In a compare rule like `end_date` vs `start_date`, the
error belongs on `end_date`, because that is the value that is invalid relative
to the start date. In a `required_if` rule, the error belongs on the field that
becomes required (for example `approver`).

### Evaluation order and dependency safety

Rules are evaluated only after normal field validation has run. A rule is
skipped when:

- the dependency field is missing or empty
- the dependency field itself has already failed its own validation
- the target field is missing and the rule is a comparison rule (no comparison is
  possible without both values)

This avoids cascade errors. In other words, if `start_date` is invalid, the
compare rule for `end_date` does not also produce a second, unrelated error on
`end_date`; the library reports the real source error on `start_date` and does
not invent a follow-on failure.

For conditional required fields, if the trigger field is missing or invalid, the
rule does nothing. The requirement is only enforced when the triggering field is
present and matches the expected value.

### Deliberate limits

This format deliberately does not support:

- nested boolean logic such as `(A AND B) OR C`
- conditions that depend on multiple fields at once
- aggregation rules across collections or arrays
- arbitrary JavaScript functions or custom code execution

The goal is to keep rules explicit, serializable, and predictable while still
covering the common patterns in the exercise: cross-field comparisons and
conditional required fields.

## Rules

- The existing tests must still pass. If you change one, say why.
- Add tests for your new behaviour, including the awkward cases.
- The library stays client-agnostic: no client names or client field names in `lib/`.
- Everything else about your submission (the hosted page, the video, the
  decisions, the transcripts) is described in the exercise document you received.
