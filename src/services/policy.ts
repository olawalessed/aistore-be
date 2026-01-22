export type UserPlan = "free" | "pro" | "premium";

export interface AccessPolicy {
    canSeeCatalog: boolean;
    refreshFrequency: number; // in seconds
    exposedFields: string[];
}

export class PolicyService {
    static getPolicy(plan: UserPlan): AccessPolicy {
        switch (plan) {
            case "premium":
                return {
                    canSeeCatalog: true,
                    refreshFrequency: 1800, // 30 mins
                    exposedFields: ["*"],
                };
            case "pro":
                return {
                    canSeeCatalog: true,
                    refreshFrequency: 3600, // 1 hour
                    exposedFields: ["id", "name", "price", "description", "category"],
                };
            default:
                return {
                    canSeeCatalog: true,
                    refreshFrequency: 86400, // 24 hours
                    exposedFields: ["id", "name", "price"],
                };
        }
    }

    static filterFields(data: any, plan: UserPlan) {
        const policy = this.getPolicy(plan);
        if (policy.exposedFields.includes("*")) return data;

        if (Array.isArray(data)) {
            return data.map(item => this.pickFields(item, policy.exposedFields));
        }
        return this.pickFields(data, policy.exposedFields);
    }

    private static pickFields(obj: any, fields: string[]) {
        const result: any = {};
        fields.forEach(f => {
            if (f in obj) result[f] = obj[f];
        });
        if (obj.updated_at) result.updated_at = obj.updated_at;
        return result;
    }
}
