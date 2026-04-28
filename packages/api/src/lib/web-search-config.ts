export interface RuntimeSkillConfig {
  skillId: string;
  envOverrides?: Record<string, string>;
}

export interface WebSearchRuntimeConfig {
  provider: "exa" | "serpapi";
  apiKey: string;
}

export function resolveWebSearchConfigFromSkills(
  skillsConfig: RuntimeSkillConfig[],
): WebSearchRuntimeConfig | undefined {
  const webSearchSkill = skillsConfig.find((s) => s.skillId === "web-search");
  const webSearchProvider = webSearchSkill?.envOverrides?.WEB_SEARCH_PROVIDER;
  if (
    webSearchProvider === "serpapi" &&
    webSearchSkill?.envOverrides?.SERPAPI_KEY
  ) {
    return {
      provider: "serpapi",
      apiKey: webSearchSkill.envOverrides.SERPAPI_KEY,
    };
  }
  if (webSearchSkill?.envOverrides?.EXA_API_KEY) {
    return {
      provider: "exa",
      apiKey: webSearchSkill.envOverrides.EXA_API_KEY,
    };
  }
  return undefined;
}
