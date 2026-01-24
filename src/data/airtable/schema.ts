// Product schema
export const PRODUCT_TABLE_SCHEMA = {
  name: "Basekart Products",
  fields: [
    { 
      name: "Product Name", 
      type: "singleLineText",
      description: "The name of your product as it appears on the store."
    },
    { 
      name: "SKU", 
      type: "singleLineText",
      description: "Unique Product Code (e.g., BK-001)."
    },
    { 
      name: "Product Description", 
      type: "richText", // Fixed: Uses the specific richText type
      description: "Detailed product info. Supports bold, italics, and lists."
    },
    { 
      name: "Old Price", 
      type: "number", 
      options: { precision: 2 },
      description: "Original price before discount. Leave blank if not on sale."
    },
    { 
      name: "Current Price", 
      type: "number", 
      options: { precision: 2 },
      description: "The actual price customers will pay."
    },
    {
      name: "Available Units",
      type: "number",
      options: { precision: 0 },
      description: "Total quantity in stock."
    },
    { 
      name: "Product Category", 
      type: "singleLineText",
      description: "Grouping for products (e.g., Shoes, Hats)."
    },
    { 
      name: "Product Image", 
      type: "multipleAttachments",
      description: "Drag and drop images here. First image is the cover."
    },
    {
      name: "Publish",
      type: "singleSelect",
      options: {
        choices: [
          { name: "yes", color: "greenBright" },
          { name: "no", color: "redBright" }
        ]
      },
      description: "Set to 'yes' to show on your live storefront."
    },
    {
      name: "last_updated",
      type: "dateTime",
      options: {
        timeZone: "utc",
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
      },
      description: "Date and time of the last modification."
    },
    {
      name: "created_at",
      type: "dateTime",
      options: {
        timeZone: "utc",
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
      },
      description: "Automatically recorded when the product is added."
    },
  ],
};


// Settings schema 
export const SETTINGS_TABLE_SCHEMA = {
  name: "Basekart Settings",
  fields: [
    { 
      name: "Store Name", 
      type: "singleLineText",
      description: "The name of your shop."
    },
    {
      name: "Default Currency",
      type: "singleSelect",
      options: {
        choices: [{ name: "NGN" }, { name: "USD" }],
      },
      description: "Primary currency for your store settings."
    },
    {
      name: "Delivery Price",
      type: "number",
      options: { precision: 2 },
      description: "Flat rate shipping fee."
    },
    { 
      name: "Delivery Policy", 
      type: "richText",
      description: "Shipping times and methods."
    },
    { 
      name: "Return Policy",
      type: "richText",
      description: "Refund and return instructions."
    },
    { 
      name: "Compliance Notes", 
      type: "richText",
      description: "Legal or regulatory notes."
    },
    { 
      name: "Support Phone",
      type: "singleLineText",
      description: "Customer service phone number."
    },
    { 
      name: "X",
      type: "singleLineText",
      description: "Direct WhatsApp contact number."
    },
    { 
      name: "Facebook",
      type: "singleLineText",
      description: "Direct WhatsApp contact number."
    },
    { 
      name: "Tiktok",
      type: "singleLineText",
      description: "Direct WhatsApp contact number."
    },
    { 
      name: "Instagram",
      type: "singleLineText",
      description: "Direct WhatsApp contact number."
    },
    { 
      name: "Youtube (Link)",
      type: "url",
      description: "Direct WhatsApp contact number."
    },
    {
      name: "last_synced_at",
      type: "dateTime",
      options: {
        timeZone: "utc",
        dateFormat: { name: "iso" },
        timeFormat: { name: "24hour" },
      },
      description: "The last successful data pull from Basekart."
    },
  ],
};