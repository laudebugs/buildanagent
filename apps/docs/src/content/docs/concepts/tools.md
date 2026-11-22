---
title: Tools
description: A tool is how an agent acts on your systems, and a failing call becomes an error the model can fix.
---

A tool is how an agent acts on your systems. You need this to understand what a tool is made of, how the loop checks the model's arguments and how a failure reaches the model.

## A tool has four parts

A tool is a name, a description the model reads, an input schema and an `execute` function. The schema is either a Standard Schema, from a library such as Zod 4.2 or later, ArkType or Valibot, or a raw JSON Schema object. A name must use 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`.

The function receives the validated input and returns a result with three channels. `content` is what the model reads, `details` is for your logs and `structured` is typed data for your code.

## A failed call becomes an error the model can fix

Every call runs the same steps in order: find the tool by name, coerce the arguments, validate them and run `execute`. A failure the model caused returns an error result to the model and throws nothing. When the model sends `"forty-two"` as an order number, it reads which field failed and why, so it can fix the call.

Return `isError: true` from your own function to report a failure you detect yourself, such as an order that does not exist.

## Tools read the caller from `app`

A tool that reads customer data must not take the customer as an argument, because the model fills in arguments and a prompt injection can send any customer's id. Pass what you know about the caller as the run's `app` option, and each tool reads it as `ctx.app`.

## Calls in one step run in parallel

When the model asks for several tools in one response, the run checks them in order and then starts them together. Results enter the transcript in the model's order, whichever call finishes first.

Next, see [how approvals work](/concepts/approvals/).
