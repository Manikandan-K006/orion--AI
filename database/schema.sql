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

CREATE TABLE IF NOT EXISTS interview_session (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
    total_score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_response (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    question_id INT NOT NULL,
    audio_path VARCHAR(500),
    transcript TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES interview_questions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ai_analysis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT NOT NULL UNIQUE,
    grammar_score DECIMAL(5,2) NOT NULL,
    pronunciation_score DECIMAL(5,2) NOT NULL,
    fluency_score DECIMAL(5,2) NOT NULL,
    confidence_score DECIMAL(5,2) NOT NULL,
    vocabulary_score DECIMAL(5,2) NOT NULL,
    emotion VARCHAR(50) NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    feedback TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (response_id) REFERENCES interview_response(id) ON DELETE CASCADE
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

-- GD Topics (pool)
CREATE TABLE IF NOT EXISTS gd_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GD Sessions with 12-char random session_code
CREATE TABLE IF NOT EXISTS gd_sessions (
    session_code VARCHAR(12) PRIMARY KEY,
    topic_id INT NOT NULL,
    status ENUM('waiting', 'preparation', 'speaking', 'completed') NOT NULL DEFAULT 'waiting',
    team_size INT NOT NULL DEFAULT 6,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (topic_id) REFERENCES gd_topics(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS gd_team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,
    team_number INT NOT NULL DEFAULT 1,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_evaluation (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
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
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_leaderboard (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,
    rank_position INT NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    credential_points DECIMAL(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Track topic refreshes per user (max 3)
CREATE TABLE IF NOT EXISTS gd_topic_refreshes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    refresh_count INT NOT NULL DEFAULT 0,
    seen_topic_ids TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY (user_id)
);

INSERT IGNORE INTO gd_topics (id, topic, category) VALUES
(1, 'Impact of Artificial Intelligence on Employment', 'technology'),
(2, 'Remote Work vs Office Culture', 'workplace'),
(3, 'Climate Change and Individual Responsibility', 'environment'),
(4, 'Social Media Influence on Youth', 'society'),
(5, 'Online Education vs Traditional Education', 'education'),
(6, 'Role of Youth in Nation Building', 'society'),
(7, 'Is Capitalism the Best Economic System?', 'economics'),
(8, 'Mental Health Awareness in Modern Society', 'health'),
(9, 'The Future of Space Exploration', 'technology'),
(10, 'Universal Basic Income: Pros and Cons', 'economics'),
(11, 'Ethical Implications of Genetic Engineering', 'science'),
(12, 'Digital Privacy vs National Security', 'technology'),
(13, 'The Gig Economy and Job Security', 'economics'),
(14, 'Should Plastic Bags Be Banned Completely?', 'environment'),
(15, 'Women in Leadership Roles', 'society');

-- Students are seeded via backend/seed.py with proper bcrypt hashes
