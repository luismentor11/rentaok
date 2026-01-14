"use client";

export type UpdateRuleType = "IPC" | "ICL" | "FIJO" | "MANUAL";

export type GuaranteeType =
  | "GARANTES"
  | "CAUCION"
  | "CONVENIO_DESALOJO"
  | "OTRO";

export const guaranteeTypeLabels: Record<GuaranteeType, string> = {
  GARANTES: "Garantes",
  CAUCION: "Caucion",
  CONVENIO_DESALOJO: "Convenio desalojo",
  OTRO: "Otro",
};

export const normalizeGuaranteeType = (
  value?: string | null
): GuaranteeType => {
  if (!value) return "OTRO";
  if (value === "GARANTES" || value === "GARANTES_PERSONAS") {
    return "GARANTES";
  }
  if (value === "CAUCION") return "CAUCION";
  if (value === "CONVENIO_DESALOJO") return "CONVENIO_DESALOJO";
  return "OTRO";
};

export const getGuaranteeTypeLabel = (value?: string | null) =>
  guaranteeTypeLabels[normalizeGuaranteeType(value)];

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

export type ContractStatus = "active" | "ended" | "deleted";

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
  status?: ContractStatus;
  deletedAt?: unknown;
  deletedByUid?: string;
  deleteReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};
