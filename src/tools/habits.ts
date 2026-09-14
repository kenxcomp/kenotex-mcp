import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { KenotexClient } from "../client.js";
import { HABIT_CADENCE_MIN_API_VERSION } from "../client.js";
import { pathSegmentId } from "../ids.js";

/** JSON schema for a habit's interval `cadence` — shared by create_habit / update_habit.
 * The acceptance table mirrors the app's `HabitCadence` (server 422s, never clamps). */
const cadenceProperties = {
  unit: {
    type: "string",
    enum: ["day", "week", "month"],
    description:
      '"day" = quota times every N days (quota ≤ interval); "week" = quota times per N weeks; "month" = quota times per N calendar months (a period runs from the 1st to the last day of the month, so the due day is always month end).',
  },
  interval: {
    type: "integer",
    minimum: 1,
    description:
      "Period length in units — also the cap on quota's calendar days. day: 1–365 (day/1 forces quota 1 = explicitly daily); week: 1–8; month: 1–12.",
  },
  quota: {
    type: "integer",
    minimum: 1,
    description:
      "Checked days required per period — distinct calendar days, so it can never exceed the days a period holds. day: 1–interval (a day/N period spans N days; day/1 therefore takes quota 1); week: 1–7×interval; month: 1–min(31×interval, 365). Defaults to 1.",
  },
  startDate: {
    type: "string",
    description:
      'Period anchor "yyyy-MM-dd". Defaults to today on create; on update it defaults to the habit\'s existing anchor. IMMUTABLE once set — sending a different date is a 422 on cadence.startDate (moving it would shift every past period boundary).',
  },
};

/** Create an array of check-in Habit tools bound to a given client. */
export function habitTools(client: KenotexClient): {
  definitions: Tool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const definitions: Tool[] = [
    {
      name: "create_habit",
      description:
        "Create a check-in habit in Kenotex — a routine the user ticks off. DAILY by default (optionally multi-dose: up to 6 dose times a day, each checked separately — medication doses, drinking water, stretching). Pass `cadence` to make it an INTERVAL habit instead: Q times every N days, N times per week(s), or N times per calendar month(s) — 'water the plants every 3 days', 'stretch twice every 5 days', 'run twice a week', 'deworm the cat twice a month'. For one-off tasks or fixed-weekday / fixed-day-of-month schedules (weekly:mon, monthly:15, after:*) use create_todo with a recurrence. Habits take no category.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short habit name" },
          times: {
            type: "array",
            items: { type: "string" },
            maxItems: 6,
            description:
              'Dose times as 24-hour "HH:mm" strings, up to 6 (e.g. ["09:00","21:00"] = twice a day). Omit or one entry = once a day; two or more = multi-dose. The server assigns each time a stable slot id — read them back via get_habit / list_habits. An INTERVAL habit (with `cadence`) takes at most ONE time — 2+ times together with an interval cadence is a 422 on times; omit `times` and the server materializes a single reminder slot (morning, ~09:00).',
          },
          remindersEnabled: {
            type: "boolean",
            default: false,
            description:
              "Schedule OS notifications at each dose time (for interval habits: on the period's due day). Pass true when the user asks to be reminded.",
          },
          endDate: {
            type: "string",
            description:
              'Optional last day, "yyyy-MM-dd" (inclusive) — e.g. a one-month course. Omit for open-ended.',
          },
          cadence: {
            type: "object",
            properties: cadenceProperties,
            required: ["unit", "interval"],
            description:
              'Interval cadence, e.g. {"unit":"day","interval":3} = every 3 days, {"unit":"day","interval":5,"quota":2} = twice every 5 days, {"unit":"week","interval":1,"quota":2} = twice a week, {"unit":"month","interval":1,"quota":2} = twice a month. Omit for a daily habit. Accepted: day interval 1–365 with quota 1–interval (day/1 with quota 1 = explicitly daily); week interval 1–8 with quota 1–7×interval; month interval 1–12 with quota 1–min(31×interval, 365) — anything else is a 422 on cadence, never clamped. A month period is a calendar month (1st → month end), so its due day is the last day of the month. `startDate` (default today) anchors the periods and can never be changed later. Needs Kenotex local API v3+: against an older app this tool refuses with VERSION_SKEW instead of letting the field be silently ignored.',
          },
        },
        required: ["title"],
      },
    },
    {
      name: "list_habits",
      description:
        "List all check-in habits with computed fields (doseCount, isMultiDose, times incl. stable slot ids, endDate, remindersEnabled, currentStreak, checkedToday, todayDoneCount, plus cadence / isIntervalHabit / currentPeriod {start,end,dueDay,doneCount,quota,done} — currentPeriod is null for daily habits). Answers 'did I check in today?' / 'what's my streak?' / 'am I done for this period?' (read currentPeriod.done — checkedToday only says whether TODAY was ticked). Call this (or get_habit) to discover slot ids before set_habit_check on a multi-dose habit.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_habit",
      description:
        "Fetch a specific habit by id. `times` returns as [{id, time}] objects — pass a slot's `id` as `slotId` when checking a dose of a multi-dose habit. Interval habits also carry `cadence` and `currentPeriod` ({start,end,dueDay,doneCount,quota,done}) — use `currentPeriod.done` for 'is this period satisfied'.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "update_habit",
      description:
        'Partially update a habit. `times` FULLY REPLACES the dose schedule (array of "HH:mm", up to 6; existing slots keep their ids by position). `times: null` or `[]` resets to a single daily dose. `endDate: null` explicitly clears the end date. `cadence` is tri-state: an object switches / retunes the interval cadence (the period anchor `startDate` is kept — sending a different one is a 422 on cadence.startDate); `cadence: null` turns the habit back into a plain daily habit (anchor kept, so switching back later keeps the same period boundaries); omitted = untouched. An interval cadence combined with 2+ dose times (new or existing) is a 422 on times. Omitted fields keep existing values.',
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
          cadence: {
            type: ["object", "null"],
            properties: cadenceProperties,
            required: ["unit", "interval"],
            description:
              'Interval cadence object (see create_habit for the accepted ranges), or null to go back to a plain daily habit. Omit to leave the cadence untouched. Needs Kenotex local API v3+ (refused with VERSION_SKEW against an older app).',
          },
        },
        required: ["id"],
      },
    },
    {
      name: "set_habit_check",
      description:
        "Set a habit's check state for a date: checked=true marks it done, checked=false removes the check. Idempotent — safe to repeat. `date` defaults to today when omitted (only pass a date to back-fill a past day). Single-dose habits take NO slotId. Multi-dose habits: pass a `slotId` (a times[].id from get_habit / list_habits) to check one dose, or omit it to check ALL of today's doses at once. INTERVAL habits (cadence) are checked per calendar day: no slotId; `date` must be a checkable day — from the cadence startDate up to today (or endDate if earlier), never in the future (422 on date). The response's doneCount / fullyDone are calendar-day facts — for 'is this period satisfied' read currentPeriod.done from get_habit.",
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
              "Dose slot id for a multi-dose habit (from the habit's times[].id). Omit for single-dose and interval habits, or to check all of today's doses.",
          },
        },
        required: ["id", "checked"],
      },
    },
    {
      name: "list_habit_checks",
      description:
        "List a habit's raw check records, optionally within an inclusive date range. Each record carries checkDate 'yyyy-MM-dd' and slotId (null for single-dose and interval habits). Use to answer history questions or compute streaks — for daily habits a day counts toward a streak only when EVERY dose is checked; for interval habits read currentPeriod / currentStreak from get_habit instead of recomputing period progress from raw rows.",
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

  /** `cadence` rides on API v3 request FIELDS, not on a new route: a pre-v3 app
   * accepts the write and silently drops the field (201, daily habit). Refuse
   * before sending when the app is known to be too old; `cadence: null` counts
   * too (it is a v3 write). Requests without the key are never gated. */
  const guardCadence = (body: Record<string, unknown>): Promise<void> =>
    "cadence" in body
      ? client.requireApiVersion(
          HABIT_CADENCE_MIN_API_VERSION,
          "habit `cadence` (interval habits)",
        )
      : Promise.resolve();

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    create_habit: async (args) => {
      await guardCadence(args);
      return client.request("POST", "/v1/habits", args);
    },
    list_habits: () => client.request("GET", "/v1/habits"),
    get_habit: (args) =>
      client.request("GET", `/v1/habits/${pathSegmentId(args.id)}`),
    update_habit: async (args) => {
      const { id, ...body } = args;
      const path = `/v1/habits/${pathSegmentId(id)}`;
      await guardCadence(body);
      return client.request("PATCH", path, body);
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
