export interface AIModel {
    name: string;
    context: number;
    type?: string[];
    price?: {
        input: number;
        output: number;
    };
}

export type AIModels = Record<string, AIModel>

export const aiModels: AIModels = {
    gemini_2_5_flash_lite: {
        name: "google/gemini-2.5-flash-lite",
        context: 1048576,
        type: ["text", "image"],
        price: {
            input: 0.10,
            output: 0.40,
        },
    },
    gemini_2_5_flash: {
        name: "google/gemini-2.5-flash",
        context: 1048576,
        type: ["text", "image"],
        price: {
            input: 0.30,
            output: 2.50,
        },
    },
    openai_gpt_4o_mini: {
        name: "openai/gpt-5-mini",
        context: 400000,
        type: ["text"],
        price: {
            input: 0.15,
            output: 0.60,
        },
    },
    deepseek_chat_v3_1: {
        name: "deepseek/deepseek-chat-v3.1:free",
        context: 163800,
        type: ["text"],
        price: {
            input: 0.15,
            output: 0.75,
        },
    },
    grok_4_fast: {
        name: "x-ai/grok-4-fast",
        context: 2000000,
        type: ["text"],
        price: {
            input: 0.20,
            output: 0.50,
        },
    },
    grok_4_1_fast: {
        name: "x-ai/grok-4.1-fast",
        context: 2000000,
        type: ["text"],
        price: {
            input: 0.20,
            output: 0.50,
        },
    },

    // Free models
    arcee_ai: {
        name: "arcee-ai/trinity-mini:free",
        context: 262144,
        type: ["text"],
        price: {
            input: 0,
            output: 0
        }
    },
    liquid_lfm_2_5_1: {
        name: "liquid/lfm-2.5-1.2b-thinking:free",
        context: 33000,
        type: ["text"],
        price: {
            input: 0,
            output: 0
        }
    },
    allenai_molmo: {
        name: "allenai/molmo-2-8b:free",
        context: 37000,
        type: ["text"],
        price: {
            input: 0,
            output: 0
        }
    },

};
