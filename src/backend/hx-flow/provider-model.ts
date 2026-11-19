// HXBot 并发（二）：一个智能体的回合等的是哪个模型（v1.7.4，CONC-02）。
//
// The key of the provider limit is provider + account + model, as the agent record names them: the
// automatic model choice moves the agent to its model before the turn starts, so the record names the
// model of the next turn. A model whose id names a server of this computer (Ollama, LM Studio,
// llama.cpp) is local: its limit starts at 1 and stays under the server's own parallel setting. Ollama
// reads OLLAMA_NUM_PARALLEL (1 when the variable is not set where HXBot can see it); LM Studio and
// llama.cpp have no setting that HXBot can read, so 1.
import { DEFAULT_PROVIDER_ACCOUNT_ID } from "@hxbot/contracts/ipc";
import type { HxProviderModel } from "./provider-gate";

const LOCAL = /^(ollama|lmstudio|lm-studio|llama\.?cpp|llamafile)[/:]/iu;

export function hxProviderModelOf(
  agent: { provider: string; model: string; providerAccountId?: string | undefined },
  env: Readonly<Record<string, string | undefined>> = process.env,
): HxProviderModel | null {
  const model = agent.model.trim();
  if (!model) return null;
  const account = agent.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
  const local = LOCAL.test(model);
  const parallel = Number(env.OLLAMA_NUM_PARALLEL);
  const localParallel =
    local && /^ollama/iu.test(model) && Number.isInteger(parallel) && parallel >= 1 ? Math.min(parallel, 16) : 1;
  return {
    key: `${agent.provider}\u0000${account}\u0000${model}`,
    local,
    ...(local ? { localParallel } : {}),
    label: `${agent.provider} · ${model}`,
  };
}
