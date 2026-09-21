
function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Nano did not return valid JSON");
  }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "RUN_NANO") return false;
  (async () => {
    if (!globalThis.LanguageModel) throw new Error("LanguageModel API is unavailable in this Chrome context.");
    const availability = await LanguageModel.availability({
      expectedInputs: [{type:"text", languages:["en"]}],
      expectedOutputs: [{type:"text", languages:["en"]}]
    });
    if (availability === "unavailable") throw new Error("Gemini Nano is unavailable on this device.");
    const options = {
  initialPrompts: [
    {
      role: "system",
      content: msg.system
    }
  ],
  expectedInputs: [
    {
      type: "text",
      languages: ["en"]
    }
  ],
  expectedOutputs: [
    {
      type: "text",
      languages: ["en"]
    }
  ]
};
    // Extension-only sampling controls are optional. Use both or neither.
    if (Number.isFinite(msg.nanoConfig?.temperature) && Number.isFinite(msg.nanoConfig?.topK)) {
      options.temperature = msg.nanoConfig.temperature;
      options.topK = msg.nanoConfig.topK;
    }
    const session = await LanguageModel.create(options);
    try {
      const raw = await session.prompt(msg.prompt, {responseConstraint: msg.schema});
      return {ok:true, raw, parsed:parseJson(raw), meta:{availability}};
    } finally {
      session.destroy();
    }
  })().then(sendResponse).catch(e => sendResponse({ok:false, error:String(e?.message || e)}));
  return true;
});
