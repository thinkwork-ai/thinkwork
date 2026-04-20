---
name: calculator
description: >
  Perform arithmetic calculations.
  Use when the user asks to do math, convert units, or evaluate expressions.
license: Apache-2.0
metadata:
  author: thinkwork
  version: "1.0.0"
---

## Tools

- **calculate** — Evaluate a mathematical expression (e.g. "2 + 2", "sqrt(16)", "15% of 200"). Supports basic arithmetic, exponentiation, logarithms, and trig functions.
- **convert_units** — Convert a value from one unit to another (e.g. km to miles, Celsius to Fahrenheit, kg to lbs).

## Usage

- Use `calculate` for any arithmetic, percentage, or expression evaluation request.
- Use `convert_units` when the user asks to convert between physical units.
- Always show the expression or conversion performed alongside the result.
- For percentages like "15% of 200", rewrite as "0.15 * 200" before calling `calculate`.
