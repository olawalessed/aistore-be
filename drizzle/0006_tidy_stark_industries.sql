CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`airtable_record_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`model` text,
	`category` text,
	`tags` text,
	`description_short` text,
	`description_long` text,
	`images` text,
	`currency` text DEFAULT 'NGN',
	`amount` real NOT NULL,
	`original_amount` real,
	`discount_percentage` real DEFAULT 0,
	`in_stock` integer DEFAULT true,
	`stock_status` text DEFAULT 'available',
	`quantity_range` text,
	`variants_tracked` integer DEFAULT false,
	`variants` text,
	`delivery_available` integer DEFAULT true,
	`pickup_available` integer DEFAULT true,
	`delivery_price` real DEFAULT 0,
	`delivery_regions` text,
	`delivery_min_hours` integer DEFAULT 4,
	`delivery_max_hours` integer DEFAULT 24,
	`returnable` integer DEFAULT true,
	`return_window_days` integer DEFAULT 7,
	`exchange_supported` integer DEFAULT true,
	`condition` text DEFAULT 'new',
	`warranty` text,
	`authenticity_claimed` integer DEFAULT true,
	`source` text DEFAULT 'airtable',
	`synced_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_store_id_idx` ON `products` (`store_id`);--> statement-breakpoint
CREATE INDEX `product_category_idx` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `product_source_idx` ON `products` (`source`);--> statement-breakpoint
CREATE INDEX `product_synced_at_idx` ON `products` (`synced_at`);--> statement-breakpoint
CREATE INDEX `product_airtable_record_idx` ON `products` (`airtable_record_id`);--> statement-breakpoint
ALTER TABLE `stores` ADD `airtable_access_token` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `airtable_access_token_iv` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `airtable_refresh_token` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `airtable_refresh_token_iv` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `airtable_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `stores` ADD `token_provider` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `product_count` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `stores` ADD `sync_status` text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `stores` ADD `sync_error` text;--> statement-breakpoint
CREATE INDEX `store_sync_status_idx` ON `stores` (`sync_status`);