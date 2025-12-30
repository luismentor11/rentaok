"use client";

export type UpdateRuleType = "IPC" | "ICL" | "FIJO" | "MANUAL";

export type GuaranteeType = "GARANTES" | "CAUCION";

export type ContractParty = {
  fullName: string;
  dni?: string;
  email?: string;
  whatsapp?: string;
  address?: string;
};

export type ContractGuarantor = {
  fullName: string;
  dni?: string;
  email?: string;
  whatsapp?: string;
  address: string;
};

export type ContractProperty = {
  id?: string;
  title: string;
  address: string;
};

export type ContractUpdateRule = {
  type: UpdateRuleType;
  periodMonths: number;
};

export type ContractPdfMetadata = {
  path: string;
  downloadUrl: string;
  uploadedAt: string;
};

export type NotificationConfig = {
  enabled: boolean;
  emailRecipients: string[];
  whatsappRecipients: string[];
};

export const defaultNotificationConfig: NotificationConfig = {
  enabled: false,
  emailRecipients: [],
  whatsappRecipients: [],
};

export type Contract = {
  property: ContractProperty;
  parties: {
    tenant: ContractParty;
    owner: ContractParty;
  };
  guarantors: ContractGuarantor[];
  dates: {
    startDate: string;
    endDate: string;
  };
  dueDay: number;
  rentAmount: number;
  updateRule: ContractUpdateRule;
  depositAmount: number;
  guaranteeType: GuaranteeType;
  pdf?: ContractPdfMetadata;
  notificationConfig: NotificationConfig;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};
