```javascript
import { defineTool } from '@nekuda/webmcp';
import { crud } from '@/redux/crud/actions';
import { customerSummary, dispatch, getState, goTo } from './runtime';

const SEARCH_FIELDS = 'name,email,phone';

export const findCustomers = defineTool({
  stableKey: 'crm.customers.find',
  name: 'find_customers',
  title: 'Find customers',
  description:
    "Search the CRM's customer list by name, email, or phone and show the matches in the customer table. Use this to look up a customer before invoicing them, to confirm a company is already on file, or to browse who exists. Returns each match's id, name, email, phone, country, and address, plus the total number of matches; returns an empty list with a note when nothing matches.",
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text to match against customer name, email, and phone. Omit to list all customers.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'How many customers to return.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ query, limit } = {}) {
    const term = String(query || '').trim();
    const options = { page: 1, items: limit ?? 10 };
    if (term) {
      options.q = term;
      options.fields = SEARCH_FIELDS;
    }

    goTo('/customer');
    // The same dispatch the customer table's own search box makes, so the rows on
    // screen are the rows this tool reports.
    await dispatch(crud.list({ entity: 'client', options }));

    const { result, isSuccess } = getState().crud.list;
    if (!isSuccess) {
      throw new Error('finding customers failed: the customer list could not be loaded');
    }

    const customers = (result?.items || []).map(customerSummary);
    const response = {
      customers,
      total_matches: result?.pagination?.total ?? customers.length,
    };
    if (customers.length === 0) {
      response.note = term
        ? `No customer matches "${term}".`
        : 'There are no customers on file yet.';
    }
    return response;
  },
});
```
