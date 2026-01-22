PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`slug` text NOT NULL,
	`email` text NOT NULL,
	`plan` text DEFAULT 'pending' NOT NULL,
	`country` text DEFAULT 'NG',
	`city` text,
	`address` text,
	`whatsapp` text,
	`phone` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`email_verification_token` text,
	`email_verification_expires` integer,
	`airtable_base_id` text,
	`airtable_product_table` text,
	`airtable_settings_table` text,
	`airtable_api_key` text,
	`airtable_api_key_iv` text,
	`sync_interval` integer DEFAULT 3600 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_stores`("id", "name", "slug", "email", "plan", "country", "city", "address", "whatsapp", "phone", "email_verified", "email_verification_token", "email_verification_expires", "airtable_base_id", "airtable_product_table", "airtable_settings_table", "airtable_api_key", "airtable_api_key_iv", "sync_interval", "status", "last_sync_at", "created_at") SELECT "id", "name", "slug", "email", "plan", "country", "city", "address", "whatsapp", "phone", "email_verified", "email_verification_token", "email_verification_expires", "airtable_base_id", "airtable_product_table", "airtable_settings_table", "airtable_api_key", "airtable_api_key_iv", "sync_interval", "status", "last_sync_at", "created_at" FROM `stores`;--> statement-breakpoint
DROP TABLE `stores`;--> statement-breakpoint
ALTER TABLE `__new_stores` RENAME TO `stores`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `stores_slug_unique` ON `stores` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_email_unique` ON `stores` (`email`);--> statement-breakpoint
CREATE INDEX `store_status_idx` ON `stores` (`status`);--> statement-breakpoint
CREATE INDEX `store_plan_idx` ON `stores` (`plan`);--> statement-breakpoint
CREATE INDEX `store_email_idx` ON `stores` (`email`);