import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";
import { pathSegmentId } from "../ids.js";

/** Create an array of check-in Habit tools bound to a given client. */
export function habitTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "create_habit",
      description:
        "Create a DAILY check-in habit in Kenotex. Use for routines the user ticks off, possibly several times a day (medication doses, drinking water, stretching). For one-off tasks or NON-daily schedules (weekly/monthly/after-completion) use create_todo with a recurrence instead — habits are daily-only and take no category.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short habit name" },
          times: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
            description:
              'Dose times as 24-hour "HH:mm" strings, up to 6 (e.g. ["09:00","21:00"] = twice a day). Omit or one entry = once a day; two or more = multi-dose. The server assigns each time a stable slot id — read them back via get_habit / list_habits.',
          },
          remindersEnabled: {
            type: "boolean",
            default: false,
            description:
              "Schedule OS notifications at each dose time. Pass true when the user asks to be reminded.",
          },
          endDate: {
            type: "string",
            description:
              'Optional last day, "yyyy-MM-dd" (inclusive) — e.g. a one-month course. Omit for open-ended.',
          },
        },
        required: ["title"],
      },
    },
    {
      name: "list_habits",
      description:
        "List all check-in habits with computed fields (doseCount, isMultiDose, times incl. stable slot ids, endDate, remindersEnabled, currentStreak, checkedToday, todayDoneCount). Answers 'did I check in today?' / 'what's my streak?'. Call this (or get_habit) to discover slot ids before set_habit_check on a multi-dose habit.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_habit",
      description:
        "Fetch a specific habit by id. `times` returns as [{id, time}] objects — pass a slot's `id` as `slotId` when checking a dose of a multi-dose habit.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_habit",
      description:
        'Partially update a habit. `times` FULLY REPLACES the dose schedule (array of "HH:mm", up to 6; existing slots keep their ids by position). `times: null` or `[]` resets to a single daily dose. `endDate: null` explicitly clears the end date. Omitted fields keep existing values.',
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          times: { type: ["array", "null"], items: { type: "string" }, maxItems: 6 },
          remindersEnabled: { type: "boolean" },
          endDate: {
            type: ["string", "null"],
            description: '"yyyy-MM-dd" (inclusive), or null to clear',
          },
        },
        required: ["id"],
      },
    },
    {
      name: "set_habit_check",
      description:
        "Set a habit's check state for a date: checked=true marks it done, checked=false removes the check. Idempotent — safe to repeat. `date` defaults to today when omitted (only pass a date to back-fill a past day). Single-dose habits take NO slotId. Multi-dose habits: pass a `slotId` (a times[].id from get_habit / list_habits) to check one dose, or omit it to check ALL of today's doses at once.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          checked: {
            type: "boolean",
            description: "true = mark checked, false = un-check",
          },
          date: {
            type: "string",
            description: '"yyyy-MM-dd"; omit for today',
          },
          slotId: {
            type: "string",
            description:
              "Dose slot id for a multi-dose habit (from the habit's times[].id). Omit for single-dose habits or to check all of today's doses.",
          },
        },
        required: ["id", "checked"],
      },
    },
    {
      name: "list_habit_checks",
      description:
        "List a habit's raw check records, optionally within an inclusive date range. Each record carries checkDate 'yyyy-MM-dd' and slotId (null for single-dose). Use to answer history questions or compute streaks — a day counts toward a streak only when EVERY dose is checked.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          from: { type: "string", description: "yyyy-MM-dd (inclusive)" },
          to: { type: "string", description: "yyyy-MM-dd (inclusive)" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_habit",
      description:
        "PERMANENTLY delete a habit AND its ENTIRE check-in history — every past check is destroyed and cannot be recovered. Confirm with the user before calling. To stop a habit while keeping its records, set an endDate via update_habit instead.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    create_habit: (args) => client.request("POST", "/v1/habits", args),
    list_habits: () => client.request("GET", "/v1/habits"),
    get_habit: (args) =>
      client.request("GET", `/v1/habits/${pathSegmentId(args.id)}`),
    update_habit: (args) => {
      const { id, ...body } = args;
      return client.request("PATCH", `/v1/habits/${pathSegmentId(id)}`, body);
    },
    set_habit_check: (args) => {
      const { id, ...body } = args;
      return client.request(
        "PUT",
        `/v1/habits/${pathSegmentId(id)}/checks`,
        body,
      );
    },
    list_habit_checks: (args) =>
      client.request(
        "GET",
        `/v1/habits/${pathSegmentId(args.id)}/checks`,
        undefined,
        {
          from: args.from as string | undefined,
          to: args.to as string | undefined,
        },
      ),
    delete_habit: (args) =>
      client.request("DELETE", `/v1/habits/${pathSegmentId(args.id)}`),
  };

  return { definitions, handlers };
}
