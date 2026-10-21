export type TaskStatus = "pending" | "processing" | "completed" | "failed";

export type Task<T = unknown> = {
  id: string;
  payload: T;
  status: TaskStatus;
  attempts: number;
  createdAt: number;
};

export type CompletionStatus = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
};

let nextId = 1;

export class TaskQueue<T = unknown> {
  private tasks: Task<T>[] = [];
  private deadLetters: Task<T>[] = [];

  /** Snapshot of how many tasks are in each status. */
  get completionStatus(): CompletionStatus {
    const status: CompletionStatus = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: this.tasks.length,
    };

    for (const task of this.tasks) {
      status[task.status]++;
    }

    return status;
  }

  /** Add a task to the end of the queue. */
  add(payload: T): Task<T> {
    const task: Task<T> = {
      id: String(nextId++),
      payload,
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    };

    this.tasks.push(task);
    return task;
  }

  /**
   * Take the oldest pending task, mark it as processing, bump attempts, and return it.
   * Returns undefined when there is nothing pending.
   */
  claimOldest(): Task<T> | undefined {
    const task = this.tasks.find((t) => t.status === "pending");
    if (!task) {
      return undefined;
    }

    task.status = "processing";
    task.attempts += 1;
    return task;
  }

  /** Snapshot of all tasks, oldest first. Returned tasks are frozen copies. */
  getAll(): ReadonlyArray<Readonly<Task<T>>> {
    return this.tasks.map((task) => Object.freeze({ ...task }));
  }

  /** Mark a processing task as completed. Ignores tasks that are not processing. */
  complete(id: string): Task<T> | undefined {
    const task = this.findProcessing(id);
    if (!task) {
      return undefined;
    }

    task.status = "completed";
    return task;
  }

  /** Mark a processing task as failed. Ignores tasks that are not processing. */
  fail(id: string): Task<T> | undefined {
    const task = this.findProcessing(id);
    if (!task) {
      return undefined;
    }

    task.status = "failed";
    return task;
  }

  /**
   * Move a processing or failed task into the dead-letter collection.
   * Removes it from the active queue.
   */
  moveToDeadLetter(id: string): Task<T> | undefined {
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      return undefined;
    }

    const task = this.tasks[index];
    if (!task || (task.status !== "processing" && task.status !== "failed")) {
      return undefined;
    }

    task.status = "failed";
    this.tasks.splice(index, 1);
    this.deadLetters.push(task);
    return task;
  }

  /** Snapshot of dead-letter tasks. Returned tasks are frozen copies. */
  getDeadLetters(): ReadonlyArray<Readonly<Task<T>>> {
    return this.deadLetters.map((task) => Object.freeze({ ...task }));
  }

  private findProcessing(id: string): Task<T> | undefined {
    const task = this.tasks.find((t) => t.id === id);
    if (!task || task.status !== "processing") {
      return undefined;
    }
    return task;
  }
}
