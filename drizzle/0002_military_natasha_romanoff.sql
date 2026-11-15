CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sample` integer DEFAULT false NOT NULL,
	`alignment` text,
	`tape_checked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scans_room_idx` ON `scans` (`room_id`,`created_at`);