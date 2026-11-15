CREATE TABLE `content` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`body` text,
	`attribution` text,
	`source` text NOT NULL,
	`filename` text,
	`sha256` text,
	`mime_type` text,
	`width_px` integer,
	`height_px` integer,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_sha256_unique` ON `content` (`sha256`);--> statement-breakpoint
CREATE INDEX `content_status_idx` ON `content` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`parent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_versions` (
	`room_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `version`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`doc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signals_content_idx` ON `signals` (`content_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `wall_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`layout_id` text NOT NULL,
	`surface_id` text NOT NULL,
	`content_id` text NOT NULL,
	`print_size_id` text NOT NULL,
	`orientation` text NOT NULL,
	`u` integer NOT NULL,
	`v` integer NOT NULL,
	`mount` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`layout_id`) REFERENCES `layouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `content`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `placements_surface_idx` ON `wall_placements` (`layout_id`,`surface_id`);