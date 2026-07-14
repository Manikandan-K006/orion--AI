CREATE DATABASE IF NOT EXISTS speaksense_ai;
USE speaksense_ai;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    register_number VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_profile (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    department VARCHAR(100),
    year VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_text TEXT NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'general',
    difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gd_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gd_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic_id INT NOT NULL,
    status ENUM('waiting', 'preparation', 'speaking', 'completed') NOT NULL DEFAULT 'waiting',
    team_size INT NOT NULL DEFAULT 6,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (topic_id) REFERENCES gd_topics(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS gd_team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    team_number INT NOT NULL DEFAULT 1,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES gd_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_evaluation (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    fluency_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    grammar_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    accent_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    relevance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    content_quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    overall_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    transcript TEXT,
    credential_points DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES gd_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_leaderboard (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    user_id INT NOT NULL,
    rank_position INT NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    credential_points DECIMAL(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES gd_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL UNIQUE,
    report_path VARCHAR(500) NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL UNIQUE,
    average_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    interviews_completed INT NOT NULL DEFAULT 0,
    total_credits DECIMAL(7,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT IGNORE INTO gd_topics (id, topic, category) VALUES
(1, 'Impact of Artificial Intelligence on Employment', 'technology'),
(2, 'Remote Work vs Office Culture', 'workplace'),
(3, 'Climate Change and Individual Responsibility', 'environment'),
(4, 'Social Media Influence on Youth', 'society'),
(5, 'Online Education vs Traditional Education', 'education');

-- Students are seeded via backend/seed.py with proper bcrypt hashes
