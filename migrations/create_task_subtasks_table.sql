-- =====================================================
-- Task Subtasks Table Migration
-- =====================================================

CREATE TABLE IF NOT EXISTS task_subtasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    due_date DATE,
    deadline DATE,
    assign_to INT,
    status VARCHAR(50) DEFAULT 'Incomplete',
    priority VARCHAR(50) DEFAULT 'Medium',
    created_by INT,
    is_deleted TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (assign_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_task_subtasks_task_id (task_id),
    INDEX idx_task_subtasks_assign_to (assign_to),
    INDEX idx_task_subtasks_is_deleted (is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

