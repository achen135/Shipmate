// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MARKER_TTL_MS,
  applyLink,
  fillableHost,
  makeMarker,
  readMarker,
} from "./marker";
import { bearerToken, hashToken, mintToken } from "./token";

const SECRET = "x".repeat(40);
const UP = "11111111-2222-4333-8444-555555555555";

describe("the Apply marker", () => {
  it("reads back what it made, until it expires", () => {
    const now = 1_000_000;
    const marker = makeMarker(UP, now, SECRET);
    expect(readMarker(marker, now + 1000, SECRET)).toMatchObject({
      userPostingId: UP,
    });
    expect(readMarker(marker, now + MARKER_TTL_MS + 1, SECRET)).toBeNull();
  });

  it("can't be forged, edited, or read with another secret", () => {
    const marker = makeMarker(UP, Date.now(), SECRET);
    const [, expires, nonce, sig] = marker.split(".");
    const other = "99999999-2222-4333-8444-555555555555";
    expect(
      readMarker(`${other}.${expires}.${nonce}.${sig}`, Date.now(), SECRET),
    ).toBeNull();
    expect(
      readMarker(`${UP}.zzzzzzzz.${nonce}.${sig}`, Date.now(), SECRET),
    ).toBeNull();
    expect(readMarker(marker, Date.now(), "y".repeat(40))).toBeNull();
    expect(readMarker("garbage", Date.now(), SECRET)).toBeNull();
  });

  it("each one is different (a fresh nonce), so each fills once", () => {
    expect(makeMarker(UP, 0, SECRET)).not.toBe(makeMarker(UP, 0, SECRET));
  });

  it("goes only on Greenhouse, Lever and Ashby links without a fragment", () => {
    vi.stubEnv("API_KEY_SERVER_SECRET", SECRET);
    expect(applyLink("https://boards.greenhouse.io/x/jobs/1", UP)).toMatch(
      /^https:\/\/boards\.greenhouse\.io\/x\/jobs\/1#shipmate=/,
    );
    expect(applyLink("https://jobs.lever.co/x/abc", UP)).toContain(
      "#shipmate=",
    );
    expect(applyLink("https://stripe.com/jobs?gh_jid=1", UP)).toBe(
      "https://stripe.com/jobs?gh_jid=1",
    );
    expect(applyLink("https://jobs.ashbyhq.com/x#/apply", UP)).toBe(
      "https://jobs.ashbyhq.com/x#/apply",
    );
    expect(applyLink("https://boards.greenhouse.io/x/jobs/1", null)).toBe(
      "https://boards.greenhouse.io/x/jobs/1",
    );
    expect(fillableHost("https://evil.example/greenhouse.io")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("without the server secret, the plain link", () => {
    vi.stubEnv("API_KEY_SERVER_SECRET", "");
    expect(applyLink("https://boards.greenhouse.io/x/jobs/1", UP)).toBe(
      "https://boards.greenhouse.io/x/jobs/1",
    );
    vi.unstubAllEnvs();
  });
});

describe("the extension's token", () => {
  it("is random, prefixed, and stored only as its SHA-256", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.token).toMatch(/^shm_ext_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token.slice(8, 20));
  });

  it("is read only from a Bearer header that looks like one", () => {
    const { token } = mintToken();
    const req = (value: string) =>
      new Request("http://x", { headers: { authorization: value } });
    expect(bearerToken(req(`Bearer ${token}`))).toBe(token);
    expect(bearerToken(req(`Basic ${token}`))).toBeNull();
    expect(bearerToken(req("Bearer sk-ant-something"))).toBeNull();
    expect(bearerToken(new Request("http://x"))).toBeNull();
  });
});
