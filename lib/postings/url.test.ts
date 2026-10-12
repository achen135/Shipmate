// @vitest-environment node
import { describe, expect, it } from "vitest";

import { canonicalizeUrl, parseAtsJob } from "./url";

// Real apply URLs from Simplify's listings.json files (2026-10-10).

describe("canonicalizeUrl", () => {
  it("strips Ashby's ?embed=true and trailing /application", () => {
    expect(
      canonicalizeUrl(
        "https://jobs.ashbyhq.com/notion/3fba1c39-c5cb-47d7-9ad2-1cec4d7e9d0c/application?embed=true",
      ),
    ).toBe(
      "https://jobs.ashbyhq.com/notion/3fba1c39-c5cb-47d7-9ad2-1cec4d7e9d0c",
    );
  });

  it("makes the Ashby job page and its form the same URL", () => {
    const page =
      "https://jobs.ashbyhq.com/realmalliance/56d8b433-31ad-43a2-997e-b8538f5f2c9f";
    expect(canonicalizeUrl(`${page}/application?embed=true`)).toBe(
      canonicalizeUrl(page),
    );
  });

  it("strips Lever's trailing /apply", () => {
    expect(
      canonicalizeUrl(
        "https://jobs.lever.co/CesiumAstro/5ac10e3b-f9d7-4029-bf25-73a191ff2636/apply",
      ),
    ).toBe(
      "https://jobs.lever.co/CesiumAstro/5ac10e3b-f9d7-4029-bf25-73a191ff2636",
    );
  });

  it("drops iCIMS presentation params and tracking params", () => {
    expect(
      canonicalizeUrl(
        "https://careers-kinaxis.icims.com/jobs/35372/job?mobile=true&needsRedirect=false",
      ),
    ).toBe("https://careers-kinaxis.icims.com/jobs/35372/job");
    expect(
      canonicalizeUrl(
        "https://example.com/careers/123?utm_source=simplify&utm_medium=x&ref=abc",
      ),
    ).toBe("https://example.com/careers/123");
  });

  it("keeps params that identify the job", () => {
    expect(
      canonicalizeUrl(
        "https://textron.taleo.net/careersection/textron/jobdetail.ftl?job=342650",
      ),
    ).toBe(
      "https://textron.taleo.net/careersection/textron/jobdetail.ftl?job=342650",
    );
    expect(
      canonicalizeUrl(
        "https://boards.greenhouse.io/embed/job_app?token=7905463",
      ),
    ).toBe("https://boards.greenhouse.io/embed/job_app?token=7905463");
  });

  it("sorts kept params and drops repeated noise", () => {
    expect(
      canonicalizeUrl(
        "https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?siteid=5014&partnerid=26336&jobid=1933902",
      ),
    ).toBe(
      "https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?jobid=1933902&partnerid=26336&siteid=5014",
    );
    expect(
      canonicalizeUrl(
        "https://jobs.jobvite.com/altamiracorps/job/oHqCAfw3?nl=1&nl=1&fr=false",
      ),
    ).toBe("https://jobs.jobvite.com/altamiracorps/job/oHqCAfw3");
  });

  it("normalizes scheme, host case, www, fragment, and trailing slash", () => {
    expect(
      canonicalizeUrl("  http://WWW.Tesla.com/careers/search/job/123/#top "),
    ).toBe("https://tesla.com/careers/search/job/123");
  });

  it("keeps path case (Workday ids are mixed case)", () => {
    const url =
      "https://ngc.wd1.myworkdayjobs.com/Northrop_Grumman_External_Site/job/X/Software-Engineer_R10211395";
    expect(canonicalizeUrl(url)).toBe(url);
  });

  it("returns unparseable input trimmed", () => {
    expect(canonicalizeUrl(" not a url ")).toBe("not a url");
    expect(canonicalizeUrl("mailto:jobs@example.com")).toBe(
      "mailto:jobs@example.com",
    );
  });
});

describe("parseAtsJob", () => {
  it("Greenhouse board URLs (both hosts) and company sites with gh_jid", () => {
    expect(
      parseAtsJob("https://job-boards.greenhouse.io/doordashusa/jobs/8171041"),
    ).toEqual({ ats: "greenhouse", jobId: "8171041" });
    expect(
      parseAtsJob("https://boards.greenhouse.io/virtu/jobs/8624410002"),
    ).toEqual({ ats: "greenhouse", jobId: "8624410002" });
    expect(
      parseAtsJob("https://job-boards.eu.greenhouse.io/x/jobs/4652765007"),
    ).toEqual({ ats: "greenhouse", jobId: "4652765007" });
    expect(
      parseAtsJob(
        "https://boards.greenhouse.io/embed/job_app?token=7669159003",
      ),
    ).toEqual({ ats: "greenhouse", jobId: "7669159003" });
    expect(
      parseAtsJob(
        "https://epicgames.com/careers/jobs/6138140004?gh_jid=6138140004",
      ),
    ).toEqual({ ats: "greenhouse", jobId: "6138140004" });
    expect(
      parseAtsJob(
        "https://peakenergy.com/get-in-touch/careers/jobs?job_id=5185852007&gh_jid=5185852007",
      ),
    ).toEqual({ ats: "greenhouse", jobId: "5185852007" });
  });

  it("Ashby with ?embed=true and /application", () => {
    expect(
      parseAtsJob(
        "https://jobs.ashbyhq.com/fireworks/0c78aede-7c21-4d1e-88f1-f309deb9819e/application?embed=true",
      ),
    ).toEqual({ ats: "ashby", jobId: "0c78aede-7c21-4d1e-88f1-f309deb9819e" });
  });

  it("the same Ashby job under two company slugs is one id", () => {
    const a = parseAtsJob(
      "https://jobs.ashbyhq.com/AtomicSemi/947338ca-e135-4398-9aa3-79e131bc03d5?jr_id=69e8f6053aa0c479643a5ee5",
    );
    const b = parseAtsJob(
      "https://jobs.ashbyhq.com/fab2/947338ca-e135-4398-9aa3-79e131bc03d5?embed=true",
    );
    expect(a).toEqual(b);
  });

  it("Lever with and without /apply", () => {
    const expected = {
      ats: "lever",
      jobId: "8c213d66-730b-4604-91b1-97dca42a59e3",
    };
    expect(
      parseAtsJob(
        "https://jobs.lever.co/shieldai/8c213d66-730b-4604-91b1-97dca42a59e3/apply",
      ),
    ).toEqual(expected);
    expect(
      parseAtsJob(
        "https://jobs.lever.co/shieldai/8C213D66-730B-4604-91B1-97DCA42A59E3",
      ),
    ).toEqual(expected);
  });

  it("Workday requisition ids, scoped to the tenant", () => {
    expect(
      parseAtsJob(
        "https://mckesson.wd3.myworkdayjobs.com/External_Careers/job/USA-TX-Irving/Software-Development-Intern---Summer-2027_JR0152635",
      ),
    ).toEqual({ ats: "workday", jobId: "mckesson:JR0152635" });
    expect(
      parseAtsJob(
        "https://psu.wd1.myworkdayjobs.com/PSU_Staff/job/Penn-State-University-Park/CSE-Part-Time-Researcher--Rui-Zhang_REQ_0000055929",
      ),
    ).toEqual({ ats: "workday", jobId: "psu:REQ_0000055929" });
    expect(
      parseAtsJob(
        "https://prysmiangroup.wd3.myworkdayjobs.com/careers/job/Highland-Heights-KY/IT-Intern_R-34910",
      ),
    ).toEqual({ ats: "workday", jobId: "prysmiangroup:R-34910" });
    expect(
      parseAtsJob(
        "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/CA-QC-LONGUEUIL/Stage---Hiver-2027---Internship---Winter-2027_01867386",
      ),
    ).toEqual({ ats: "workday", jobId: "globalhr:01867386" });
  });

  it("one Workday req posted on two career sites is one id", () => {
    const a = parseAtsJob(
      "https://marvell.wd1.myworkdayjobs.com/MarvellCareers2/job/Ottawa-Canada/Data-Center-Silicon-Hardware-Engineering-Intern---Winter-2027_2604525",
    );
    const b = parseAtsJob(
      "https://marvell.wd1.myworkdayjobs.com/MarvellCareers/job/Ottawa-Canada/Data-Center-Silicon-Hardware-Engineering-Intern---BS---2027-Co-Op_2604525/apply",
    );
    expect(a).toEqual({ ats: "workday", jobId: "marvell:2604525" });
    expect(b).toEqual(a);
  });

  it("SmartRecruiters numeric ids, with or without a title slug", () => {
    expect(
      parseAtsJob(
        "https://jobs.smartrecruiters.com/BoschGroup/744000154478885",
      ),
    ).toEqual({ ats: "smartrecruiters", jobId: "744000154478885" });
    expect(
      parseAtsJob(
        "https://jobs.smartrecruiters.com/BoschGroup/744000154478885-software-intern",
      ),
    ).toEqual({ ats: "smartrecruiters", jobId: "744000154478885" });
  });

  it("null for other boards and malformed ATS URLs", () => {
    expect(
      parseAtsJob(
        "https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/26013266",
      ),
    ).toBeNull();
    expect(parseAtsJob("https://jobs.lever.co/shieldai")).toBeNull();
    expect(
      parseAtsJob("https://job-boards.greenhouse.io/doordashusa"),
    ).toBeNull();
    expect(parseAtsJob("not a url")).toBeNull();
  });
});
