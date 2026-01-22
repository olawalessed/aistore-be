CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`country` text DEFAULT 'NG',
	`city` text,
	`address` text,
	`whatsapp` text,
	`phone` text,
	`airtable_base_id` text NOT NULL,
	`airtable_table` text NOT NULL,
	`airtable_settings_table` text,
	`airtable_api_key` text NOT NULL,
	`airtable_api_key_iv` text NOT NULL,
	`sync_interval` integer DEFAULT 3600 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sync_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE INDEX `store_status_idx` ON `stores` (`status`);--> statement-breakpoint
CREATE INDEX `store_plan_idx` ON `stores` (`plan`);