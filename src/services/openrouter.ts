import { OpenRouter } from "@openrouter/sdk";
import { aiModels } from "./models";

/**
 * OpenRouter AI wrapper.
 */
export async function callOpenRouter(apiKey: string, systemPrompt: string, userPrompt: string, model: string) {
    const openrouter = new OpenRouter({
        apiKey: apiKey,
    });

    const response = await openrouter.chat.send({
        model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ]
    });

    const content = response.choices[0]?.message?.content;
    const text = Array.isArray(content) ? content.join("") : (content || "");

    return { response: text };
}
