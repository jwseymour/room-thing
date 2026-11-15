ALTER TABLE `content` ADD `title` text;--> statement-breakpoint
ALTER TABLE `content` ADD `width_mm` integer;--> statement-breakpoint
ALTER TABLE `content` ADD `height_mm` integer;--> statement-breakpoint
ALTER TABLE `content` ADD `image_rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `wall_placements` ADD `width_mm` integer;--> statement-breakpoint
ALTER TABLE `wall_placements` ADD `height_mm` integer;