export const defaults = {
  oauth: {
    provider: "microsoft",
    scopes: ["openid", "profile", "offline_access"],
    redirectUri: "/.auth/callback"
  },
  /**
   * Per‑provider and per‑tool toggles
   * ------------------------------------------------------
   * `enabled`      – master on/off switch for the whole SaaS integration.
   * `operations`   – fine‑grained flags for individual MCP tools that live inside that provider.
   *                  Omit the key to inherit the parent provider's `enabled` state.
   */
  tools: {
    pandadoc: {
      enabled: true,                // turn *all* PandaDoc tools on/off here
      oauth: true,
      rateLimit: { max: 30, period: "1m" },
      operations: {
        sendDocument:  { enabled: true,  rateLimit: { max: 20, period: "1m" } },
        getStatus:     { enabled: true },
        listTemplates: { enabled: false }  // disabled until legal sign‑off
      }
    },
    hubspot: {
      enabled: true,
      oauth: true,
      rateLimit: { max: 100, period: "1m" },
      operations: {
        searchContacts: { enabled: true },
        createContact: { enabled: true },
        listDeals: { enabled: true }
      }
    },
    xero: {
      enabled: false,  // disabled by default
      oauth: true,
      rateLimit: { max: 50, period: "1m" },
      operations: {
        createInvoice: { enabled: true },
        listContacts: { enabled: true }
      }
    },
    netsuite: {
      enabled: false,  // disabled by default
      oauth: true,
      rateLimit: { max: 30, period: "1m" },
      operations: {
        createSalesOrder: { enabled: true },
        searchCustomers: { enabled: true }
      }
    },
    autotask: {
      enabled: false,  // disabled by default
      oauth: true,
      rateLimit: { max: 40, period: "1m" },
      operations: {
        createTicket: { enabled: true },
        updateTicket: { enabled: true }
      }
    }
  },
  worker: { 
    logLevel: "info" 
  }
} as const;

// Type inference for the config structure
export type MCPConfig = {
  oauth: {
    provider: string;
    scopes: string[];
    redirectUri: string;
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  };
  tools: {
    [K in keyof typeof defaults.tools]: typeof defaults.tools[K] & {
      clientId: string;
      clientSecret: string;
    };
  };
  worker: {
    logLevel: string;
  };
}; 