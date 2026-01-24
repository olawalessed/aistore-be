import { sampleProductFieldData } from "../data/sample-products";

// create table
export async function createShopTable(
  baseId: string, // Airtable Base id
  tableSchema: any, // This is the platform defined schema we're using
  accessToken: string // This is the user's access token
): Promise<{ id: string; name: string }> {
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tableSchema),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create table: ${error}`);
  }

  return res.json() as Promise<{ id: string; name: string }>;
}

//   Create new base for user
export async function createShopBase(baseName: string, accessToken: string) {
  const res = await fetch("https://api.airtable.com/v0/meta/bases", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: baseName,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Create base failed: ${error}`);
  }

  return res.json() as Promise<{ id: string; name: string }>;
}

//   Create new base for user
export async function fetchBaseInfo(accessToken: string) {
  const res = await fetch("https://api.airtable.com/v0/meta/bases", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Create base failed: ${error}`);
  }

  return res.json() as Promise<{ bases: { id: string; name: string }[] }>;
}


// Add sample product data
export async function addSampleProducts(
  baseId: string,
  tableId: string,
  accessToken: string
) {
  const records = sampleProductFieldData.map((item) => ({
    fields: {
      "Product Name": item.name,
      SKU: `SAMPLE-${item.id}`,
      "Product Description": `This is a sample product from ${item.store}.`,
      "Current Price": parseFloat(item.price.replace(/[^\d.]/g, "")), // Cleans ₦ and ,
      "Available Units": 10,
      "Product Category": "Electronics",
      "Product Image": [{ url: item.image }], // Attachments must be an array of objects
      Publish: "no", // Default to No as requested
    },
  }));

  const res = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to add sample records: ${error}`);
  }

  return res.json();
}
