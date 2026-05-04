import type { Skill } from "../models/skill";

export const invoiceSkill: Skill = {
  id: "invoice",
  name: "Invoice",
  description: "Professional invoice with header, line-item table, and totals.",
  triggers: ["invoice", "bill", "receipt", "charge", "payment", "quote", "estimate", "billing"],
  od: {
    mode: "invoice",
    platform: "pdf",
    scenario: "finance",
    design_system: { requires: false },
    example_prompt: "An invoice for three web services: design ($500), development ($1200), SEO setup ($300). Tax 10%. Payment due in 30 days.",
  },
  instructions: `
Produce professional invoices. Structure every invoice in this exact order:
1. h1 — "INVOICE" or the company/freelancer name.
2. Invoice metadata — individual p blocks for: Invoice #, Issue Date, Due Date, Bill To (name + address).
3. Line-items table — columns: Description | Qty | Unit Price | Total.
   - thead row with th elements for the column headers.
   - tbody rows for each line item.
   - After line items, add rows for: Subtotal, Tax (label + rate), TOTAL DUE (bold).
4. Payment terms — p or ul below the table (e.g. bank details, payment method, late fee policy).
5. Notes — optional p at the bottom.

Numeric rules:
- All currency values formatted to 2 decimal places (e.g. $1,200.00).
- Amounts in the Total column must be Qty × Unit Price.
- Subtotal = sum of all line item totals.
- Tax amount = Subtotal × rate.
- Total Due = Subtotal + Tax.
- Never leave a math cell blank — compute it.
`.trim(),
};
