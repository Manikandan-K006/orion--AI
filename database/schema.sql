CREATE DATABASE IF NOT EXISTS speaksense_ai;
USE speaksense_ai;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
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
    status ENUM('in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'in_progress',
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO interview_questions (question_text, category, difficulty)
SELECT 'Tell me about yourself and your academic background.', 'introduction', 'easy'
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE question_text = 'Tell me about yourself and your academic background.');

INSERT INTO interview_questions (question_text, category, difficulty)
SELECT 'Describe a project where you solved a difficult problem.', 'technical', 'medium'
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE question_text = 'Describe a project where you solved a difficult problem.');

INSERT INTO interview_questions (question_text, category, difficulty)
SELECT 'How do you handle pressure during interviews or deadlines?', 'behavioral', 'medium'
WHERE NOT EXISTS (SELECT 1 FROM interview_questions WHERE question_text = 'How do you handle pressure during interviews or deadlines?');
