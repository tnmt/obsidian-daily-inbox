import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { CancelledError } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { AccessTokenRejectedError, fetchMeasures, parseMeasuresResponse } from "./client";
import { WithingsSourceError } from "./errors";

function response(status: number, json: unknown): RequestUrlResponse {
  return { status, headers: {}, arrayBuffer: new ArrayBuffer(0), json, text: JSON.stringify(json) };
}
const mockHttp = (handler: (p: RequestUrlParam) => RequestUrlResponse): HttpRequester => vi.fn(async (p) => handler(p));
const signal = () => new AbortController().signal;

const okBody = {
  status: 0,
  body: {
    timezone: "Asia/Tokyo",
    measuregrps: [{ grpid: 1, date: 1790000000, measures: [{ value: 557, type: 1, unit: -1 }, { value: 62, type: 11, unit: 0 }] }],
  },
};

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a failure");
}

describe("fetchMeasures", () => {
  it("posts getmeas with the range and a bearer token, decoding value * 10^unit", async () => {
    const http = mockHttp(() => response(200, okBody));
    const result = await fetchMeasures(http, "tok", 100, 200, signal());
    const call = vi.mocked(http).mock.calls[0][0];
    expect(call.url).toBe("https://wbsapi.withings.net/measure");
    expect(call.headers).toEqual({ Authorization: "Bearer tok" });
    const form = new URLSearchParams(call.body as string);
    expect(Object.fromEntries(form)).toMatchObject({ action: "getmeas", startdate: "100", enddate: "200" });
    expect(result.timezone).toBe("Asia/Tokyo");
    expect(result.groups[0].measures).toEqual([{ type: 1, value: 55.7 }, { type: 11, value: 62 }]);
  });

  it.each([401, 293])("reports envelope status %i as a rejected access token", async (status) => {
    const err = await failure(fetchMeasures(mockHttp(() => response(200, { status })), "t", 1, 2, signal()));
    expect(err).toBeInstanceOf(AccessTokenRejectedError);
  });

  it("maps status 601 to rate-limited", async () => {
    const err = await failure(fetchMeasures(mockHttp(() => response(200, { status: 601 })), "t", 1, 2, signal()));
    expect(err).toMatchObject({ kind: "rate-limited" });
  });

  it("maps HTTP 5xx and network failures to transient", async () => {
    expect(await failure(fetchMeasures(mockHttp(() => response(503, {})), "t", 1, 2, signal()))).toMatchObject({ kind: "transient" });
    const down: HttpRequester = async () => {
      throw new Error("offline");
    };
    expect(await failure(fetchMeasures(down, "t", 1, 2, signal()))).toMatchObject({ kind: "transient" });
  });

  it("maps an unparsable body to malformed", async () => {
    const http: HttpRequester = async () => ({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      get json(): unknown {
        throw new SyntaxError("bad json");
      },
      text: "<html>",
    });
    expect(await failure(fetchMeasures(http, "t", 1, 2, signal()))).toMatchObject({ kind: "malformed" });
  });

  it("does not call the network once cancelled", async () => {
    const http = mockHttp(() => response(200, okBody));
    const controller = new AbortController();
    controller.abort();
    expect(await failure(fetchMeasures(http, "t", 1, 2, controller.signal))).toBeInstanceOf(CancelledError);
    expect(http).not.toHaveBeenCalled();
  });
});

describe("parseMeasuresResponse", () => {
  it("rejects unexpected shapes", () => {
    expect(() => parseMeasuresResponse({})).toThrow(WithingsSourceError);
    expect(() => parseMeasuresResponse({ timezone: "UTC", measuregrps: [{ date: 1, measures: [{ type: 1 }] }] })).toThrow(WithingsSourceError);
  });
});
