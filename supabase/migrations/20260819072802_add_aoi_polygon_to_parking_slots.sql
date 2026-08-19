/*
# Add AOI Polygon to Parking Slots

Adds normalized AOI coordinates, the monitoring camera reference, and an
optional AOI overlay color to parking slots.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'aoi_polygon') THEN
    ALTER TABLE parking_slots ADD COLUMN aoi_polygon jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'camera_id') THEN
    ALTER TABLE parking_slots ADD COLUMN camera_id uuid REFERENCES cameras(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'parking_slots' AND column_name = 'aoi_color') THEN
    ALTER TABLE parking_slots ADD COLUMN aoi_color text;
  END IF;
END $$;