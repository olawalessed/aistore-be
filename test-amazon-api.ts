import { fetchAmazonProducts } from './src/workers/discovery.js';
import { CloudflareBindings } from './src/types/index.js';
import type { KVNamespace, R2Bucket, DurableObjectNamespace } from './src/types/cloudflare.js';

// Test configuration - replace with your actual credentials for testing
const testEnv: CloudflareBindings = {
  AMAZON_ACCESS_KEY: 'your_test_access_key',
  AMAZON_SECRET_KEY: 'your_test_secret_key',
  AMAZON_ASSOCIATE_TAG: 'your_test_associate_tag',
  AMAZON_REGION: 'us-east-1',
  DATABASE_URL: '',
  PRODUCT_CACHE: {} as KVNamespace,
  STATE_KV: {} as KVNamespace,
  IMAGES: {} as R2Bucket,
  STATE_MANAGER: {} as DurableObjectNamespace,
  OPEN_ROUTER_KEY: '',
  FRONTEND_URL: '',
  REVALIDATION_SECRET: ''
};

async function testAmazonAPI() {
  try {
    console.log('Testing Amazon PAAPI5 integration...');
    
    const products = await fetchAmazonProducts('electronics', testEnv);
    
    console.log(`Successfully fetched ${products.length} products`);
    
    if (products.length > 0) {
      console.log('Sample product:', {
        asin: products[0].asin,
        title: products[0].title,
        price: products[0].price,
        rating: products[0].rating,
        category: products[0].category
      });
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Uncomment to test: testAmazonAPI();
