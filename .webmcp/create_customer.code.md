```javascript
import { defineTool } from '@nekuda/webmcp';
import { crud } from '@/redux/crud/actions';
import { request } from '@/request';
import { customerSummary, dispatch, goTo, unwrap } from './runtime';

export const createCustomer = defineTool({
  stableKey: 'crm.customers.create',
  name: 'create_customer',
  title: 'Add a customer',
  description:
    'Add a new customer to the CRM and show it in the customer table. Use this when the person or company you need to invoice is not on file yet; check with find_customers first, because this does not detect duplicates. Requires a name; email, phone, country, and address are optional. Returns the new customer\'s id and saved fields.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        description: "The customer's name or company name.",
      },
      email: { type: 'string', description: 'Contact email address.' },
      phone: { type: 'string', description: 'Contact phone number.' },
      country: {
        type: 'string',
        description: 'Country, as a two-letter code such as US or IL.',
      },
      address: { type: 'string', description: 'Postal address.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute({ name, email, phone, country, address } = {}) {
    const customerName = String(name || '').trim();
    if (!customerName) {
      throw new Error('a customer name is required');
    }

    const jsonData = { name: customerName };
    if (email) jsonData.email = String(email).trim();
    if (phone) jsonData.phone = String(phone).trim();
    if (country) jsonData.country = String(country).trim();
    if (address) jsonData.address = String(address).trim();

    const created = unwrap(
      await request.create({ entity: 'client', jsonData }),
      `creating customer "${customerName}"`
    );

    goTo('/customer');
    // Reload the table so the new row is visible where the user is looking.
    await dispatch(crud.list({ entity: 'client', options: { page: 1, items: 10 } }));

    return { customer: customerSummary(created) };
  },
});
```
