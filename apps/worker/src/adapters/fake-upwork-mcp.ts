import {
  upworkJobSearchOutcomeSchema,
  upworkJobSearchRequestSchema,
  type UpworkJobSearchOutcome,
  type UpworkJobSearchRequest,
  type UpworkMcpPort
} from "@upwork-agent/core";

export type FakeUpworkSearchResponder = (
  input: UpworkJobSearchRequest
) => UpworkJobSearchOutcome | Promise<UpworkJobSearchOutcome>;

function defaultOutcome(input: UpworkJobSearchRequest): UpworkJobSearchOutcome {
  const externalJobId = `fake-make-openai-automation-${input.campaignId}`;
  return {
    kind: "page",
    jobs: [
      {
        externalJobId,
        canonicalUrl: `https://www.upwork.com/jobs/${externalJobId}`,
        postedAt: "2026-08-15T00:00:00.000Z",
        title: "Build a Make.com and OpenAI automation workflow",
        description:
          "Connect Make.com, OpenAI, webhooks, and an internal API with a documented handoff.",
        skills: ["Make.com", "OpenAI", "API integration"],
        categoryIds: ["automation", "ai-development"],
        experienceLevel: "expert",
        jobType: "fixed",
        fixedBudget: { currency: "USD", min: 1_500, max: 2_500 },
        proposalCount: 3,
        paymentVerified: true,
        client: {
          countryCode: "US",
          timeZone: "America/New_York",
          hireCount: 18
        },
        projectLengthBand: "one_to_three_months",
        hoursPerWeekBand: "under_30",
        isContractToHire: false
      }
    ]
  };
}

export class FakeUpworkMcpPort implements UpworkMcpPort {
  readonly #responder: FakeUpworkSearchResponder;

  public constructor(responder: FakeUpworkSearchResponder = defaultOutcome) {
    this.#responder = responder;
  }

  public async searchJobs(inputValue: UpworkJobSearchRequest): Promise<UpworkJobSearchOutcome> {
    const input = upworkJobSearchRequestSchema.parse(inputValue);
    const outcome = upworkJobSearchOutcomeSchema.parse(await this.#responder(input));
    if (outcome.kind !== "page") return outcome;
    return upworkJobSearchOutcomeSchema.parse({
      ...outcome,
      jobs: outcome.jobs.slice(0, input.maxResults)
    });
  }
}
