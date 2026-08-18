```javascript
import { defineTool } from '@nekuda/webmcp';
import { erp } from '@/redux/erp/actions';
import { request } from '@/request';
import {
  asDateOnly,
  dispatch,
  financeSettings,
  goTo,
  invoiceSummary,
  money,
  resolveCustomer,
  unwrap,
} from './runtime';

const DEFAULT_TERM_DAYS = 30;

export const createInvoice = defineTool({
  stableKey: 'billing.invoices.create',
  name: 'create_invoice',
  title: 'Draft an invoice',
  description:
    'Create a new invoice for an existing customer and open it. Use this to bill a customer for one or more line items; identify the customer by name (it must already be on file — create_customer adds one) or by id. The invoice is always created as a draft, so nothing is sent to the customer and it can be reviewed or changed in the app before it goes out; the invoice number is taken from the app\'s own numbering settings. Returns the created invoice\'s id, number, line items, subtotal, tax, and total.',
  inputSchema: {
    type: 'object',
    properties: {
      customer: {
        type: 'string',
        description:
          "The customer's name or id. Must already exist; the name must match exactly one customer.",
      },
      items: {
        type: 'array',
        minItems: 1,
        description: 'The line items to bill.',
        items: {
          type: 'object',
          properties: {
            item_name: { type: 'string', minLength: 1, description: 'What is being billed.' },
            description: { type: 'string', description: 'Optional detail for this line.' },
            quantity: { type: 'number', exclusiveMinimum: 0, description: 'How many units.' },
            price: { type: 'number', minimum: 0, description: 'Price per unit.' },
          },
          required: ['item_name', 'quantity', 'price'],
          additionalProperties: false,
        },
      },
      tax_rate: {
        type: 'number',
        minimum: 0,
        default: 0,
        description: 'Tax rate as a percentage, for example 17 for 17%.',
      },
      date: { type: 'string', description: 'Invoice date as YYYY-MM-DD. Defaults to today.' },
      due_date: {
        type: 'string',
        description: 'Date the invoice expires as YYYY-MM-DD. Defaults to 30 days after the invoice date.',
      },
      notes: { type: 'string', description: 'Free-text notes shown on the invoice.' },
    },
    required: ['customer', 'items'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute({ customer, items, tax_rate, date, due_date, notes } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('an invoice needs at least one line item');
    }

    const client = await resolveCustomer(customer);
    const { last_invoice_number: lastNumber } = financeSettings();

    const invoiceDate = asDateOnly(date, 'date') || new Date().toISOString();
    const dueDate =
      asDateOnly(due_date, 'due_date') ||
      new Date(
        new Date(invoiceDate).getTime() + DEFAULT_TERM_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

    const lineItems = items.map((item, index) => {
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`line ${index + 1} needs a quantity above 0`);
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`line ${index + 1} needs a price of 0 or more`);
      }
      return {
        itemName: String(item.item_name).trim(),
        description: item.description ? String(item.description) : '',
        quantity,
        price,
        total: money(quantity * price),
      };
    });

    // Only the keys the invoice endpoint's own validator accepts, in the same
    // shape the app's create form posts. Status is pinned to draft: drafting is
    // reversible, sending an invoice to a customer is not, so that step stays a
    // human action in the app.
    const jsonData = {
      client: client._id,
      number: (lastNumber ?? 0) + 1,
      year: new Date(invoiceDate).getFullYear(),
      status: 'draft',
      date: invoiceDate,
      expiredDate: dueDate,
      items: lineItems,
      taxRate: tax_rate ?? 0,
      notes: notes ? String(notes) : '',
    };

    const created = unwrap(
      await request.create({ entity: 'invoice', jsonData }),
      `creating an invoice for ${client.name}`
    );

    await dispatch(erp.currentItem({ data: created }));
    goTo(`/invoice/read/${created._id}`);

    return {
      invoice: {
        ...invoiceSummary({ ...created, client }),
        items: (created.items || []).map((item) => ({
          item_name: item.itemName,
          quantity: item.quantity,
          price: money(item.price),
          total: money(item.total),
        })),
        sub_total: money(created.subTotal),
        tax_rate: created.taxRate ?? 0,
        tax_total: money(created.taxTotal),
      },
      note: 'Created as a draft — review it in the app and send it from there.',
    };
  },
});
```
