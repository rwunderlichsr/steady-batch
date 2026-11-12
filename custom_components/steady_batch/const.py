"""Constants for Steady Batch."""

DOMAIN = "steady_batch"
SIGNAL = "steady_batch_updated"

MEALS = ("Breakfast", "Lunch", "Dinner", "Snack")

# Local clock times. Home Assistant applies its own timezone.
SLOT_CLOCK = {
    "Breakfast": ((7, 30), (8, 0)),
    "Lunch": ((12, 0), (12, 30)),
    "Snack": ((15, 30), (16, 0)),
    "Dinner": ((18, 0), (18, 30)),
}
