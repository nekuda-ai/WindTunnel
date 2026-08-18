```javascript
import { defineTool } from '@nekuda/webmcp';
import { erp } from '@/redux/erp/actions';
import {
  balanceDue,
  customerSummary,
  dispatch,
  goTo,
  invoiceSummary,
  money,
  resolveInvoice,
} from './runtime';

export const getInvoice = defineTool({
  stableKey: 'billing.invoices.get',
  name: 'get_invoice',
  title: 'Open an invoice',
  description:
    'Open one invoice and return its full detail, identified by its invoice number (with year) or its id. Use this after find_invoices when you need the line items, the tax and totals breakdown, or the exact balance still due before recording a payment. Returns the customer, dates, every line item with quantity and price, subtotal, tax, total, amount already paid, balance due, status, and payment status, and navigates the page to that invoice.',
  inputSchema: {
    type: 'object',
    properties: {
      number: {
        type: 'integer',
        description: 'The invoice number as shown in the invoice table. Use with year.',
      },
      year: {
        type: 'integer',
        description: "The invoice's year. Defaults to the current year when a number is given.",
      },
      invoice_id: {
        type: 'string',
        description:
          "The invoice's id, if you already have it from another tool. Use instead of number and year.",
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ number, year, invoice_id } = {}) {
    const invoice = await resolveInvoice({ invoice_id, number, year });

    // Seed the app's current-item state before navigating so the invoice page
    // renders this record straight away instead of flashing its loader.
    await dispatch(erp.currentItem({ data: invoice }));
    goTo(`/invoice/read/${invoice._id}`);

    return {
      invoice: {
        ...invoiceSummary(invoice),
        customer_details: customerSummary(invoice.client),
        notes: invoice.notes || null,
        items: (invoice.items || []).map((item) => ({
          item_name: item.itemName,
          description: item.description || null,
          quantity: item.quantity,
          price: money(item.price),
          total: money(item.total),
        })),
        sub_total: money(invoice.subTotal),
        tax_rate: invoice.taxRate ?? 0,
        tax_total: money(invoice.taxTotal),
        discount: money(invoice.discount),
        balance_due: balanceDue(invoice),
        payment_count: (invoice.payment || []).length,
      },
    };
  },
});
```
