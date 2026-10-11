// The array order defines the only valid forward status transition.
export const statuses = ["to_do", "pending", "in_progress", "done"] as const;

// Actors are predefined because authentication is outside this assignment.
export const actors = ["john.doe", "jane.smith", "alex.lee"] as const;
