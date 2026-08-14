import { z } from "zod";

export const clientProfileMappingFieldValues = ["name", "email", "phone", "address", "notes"] as const;
export const petProfileMappingFieldValues = [
  "name",
  "dateOfBirth",
  "species",
  "breed",
  "weight",
  "gender",
  "spayNeuterStatus",
  "vaccineStatus",
  "source",
  "acquiredAgo",
  "age",
  "behaviorNotes",
  "trainingNotes",
  "medicalNotes",
  "petSittingNotes"
] as const;

export const formBuilderFieldTypeValues = [
  "text",
  "textarea",
  "radio",
  "checkbox",
  "select",
  "file_upload",
  "date",
  "email",
  "phone",
  "pet_info"
] as const;

export const displayOnlyFormFieldTypeValues = ["text_block", "heading", "paragraph", "html", "divider"] as const;
export const legacyFormFieldTypeValues = ["newsletter_opt_in", "pet_info_group"] as const;
export const knownStoredFormFieldTypeValues = [
  ...formBuilderFieldTypeValues,
  ...displayOnlyFormFieldTypeValues,
  ...legacyFormFieldTypeValues
] as const;
export const optionListFormFieldTypeValues = ["radio", "checkbox", "select"] as const;

export const clientProfileMappingFieldSchema = z.enum(clientProfileMappingFieldValues);
export const petProfileMappingFieldSchema = z.enum(petProfileMappingFieldValues);

export const formFieldProfileMappingSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("client"),
    field: clientProfileMappingFieldSchema
  }),
  z.object({
    target: z.literal("pet"),
    field: petProfileMappingFieldSchema
  })
]);

const storedFieldOptionSchema = z.union([
  z.string().trim().min(1),
  z.object({
    label: z.string().trim().min(1)
  })
]);

const storedFieldCommonSchema = z
  .object({
    key: z.string().trim().min(1).optional(),
    label: z.string().trim().min(1).optional(),
    placeholder: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    profileMapping: formFieldProfileMappingSchema.optional()
  })
  .passthrough();

const builderFieldCommonSchema = z.object({
  key: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  profileMapping: formFieldProfileMappingSchema.optional()
});

const storedScalarFieldSchema = storedFieldCommonSchema.extend({
  type: z.enum(["text", "textarea", "file_upload", "date", "email", "phone"])
});

const storedOptionFieldSchema = storedFieldCommonSchema.extend({
  type: z.enum(optionListFormFieldTypeValues),
  options: z.array(storedFieldOptionSchema).optional()
});

const storedPetInfoFieldSchema = storedFieldCommonSchema.extend({
  type: z.literal("pet_info")
});

const storedLegacyNewsletterFieldSchema = storedFieldCommonSchema.extend({
  type: z.literal("newsletter_opt_in"),
  newsletterCheckboxLabel: z.string().optional()
});

const storedLegacyPetInfoGroupFieldSchema = storedFieldCommonSchema.extend({
  type: z.literal("pet_info_group")
});

const storedDisplayOnlyFieldSchema = storedFieldCommonSchema.extend({
  type: z.enum(displayOnlyFormFieldTypeValues),
  content: z.string().optional()
});

const storedFallbackFieldSchema = storedFieldCommonSchema.extend({
  type: z.string().trim().min(1),
  options: z.array(storedFieldOptionSchema).optional()
});

const builderScalarFieldSchema = builderFieldCommonSchema.extend({
  type: z.enum(["text", "textarea", "file_upload", "date", "email", "phone"])
});

const builderOptionFieldSchema = builderFieldCommonSchema.extend({
  type: z.enum(optionListFormFieldTypeValues),
  options: z.array(z.string().trim().min(1)).min(1)
});

const builderPetInfoFieldSchema = builderFieldCommonSchema.extend({
  type: z.literal("pet_info")
});

export const adminFormBuilderFieldSchema = z.discriminatedUnion("type", [
  builderScalarFieldSchema,
  builderOptionFieldSchema,
  builderPetInfoFieldSchema
]);

export const storedFormFieldSchema = z.union([
  storedScalarFieldSchema,
  storedOptionFieldSchema,
  storedPetInfoFieldSchema,
  storedLegacyNewsletterFieldSchema,
  storedLegacyPetInfoGroupFieldSchema,
  storedDisplayOnlyFieldSchema,
  storedFallbackFieldSchema
]);

export const formFieldSchema = storedFormFieldSchema;

export type FormFieldProfileMapping = z.infer<typeof formFieldProfileMappingSchema>;
export type AdminFormBuilderField = z.infer<typeof adminFormBuilderFieldSchema>;
export type FormField = z.infer<typeof formFieldSchema>;

export function normalizeFormFieldType(value: unknown): string {
  if (typeof value !== "string") {
    return "text";
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "" ? "text" : normalized;
}

export function isDisplayOnlyFormFieldType(type: string): boolean {
  return (displayOnlyFormFieldTypeValues as readonly string[]).includes(normalizeFormFieldType(type));
}

export function isOptionListFormFieldType(type: string): boolean {
  return (optionListFormFieldTypeValues as readonly string[]).includes(normalizeFormFieldType(type));
}

export function isFileUploadFormFieldType(type: string): boolean {
  return normalizeFormFieldType(type) === "file_upload";
}

export function isPetInfoFormFieldType(type: string): boolean {
  return normalizeFormFieldType(type) === "pet_info";
}

export function getFormFieldLabel(
  field: Pick<FormField, "type"> & Partial<Pick<FormField, "label">>,
  index: number
): string {
  const label = typeof field.label === "string" ? field.label.trim() : "";
  if (label !== "") {
    return label;
  }

  return normalizeFormFieldType(field.type) === "newsletter_opt_in" ? "Newsletter Opt-In" : `Field ${index + 1}`;
}

export function getFormFieldOptions(field: unknown): string[] {
  if (typeof field !== "object" || field == null || !("options" in field) || !Array.isArray(field.options)) {
    return [];
  }

  return field.options
    .map((option) => {
      if (typeof option === "string") {
        return option;
      }

      if (typeof option === "object" && option != null && "label" in option) {
        const label = (option as { label?: unknown }).label;
        return typeof label === "string" ? label : "";
      }

      return "";
    })
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

export function hasFileUploadFormField(fields: ReadonlyArray<FormField> | undefined): boolean {
  return (fields ?? []).some((field) => isFileUploadFormFieldType(field.type));
}
