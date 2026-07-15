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
    team_size INT NOT NULL DEFAULT 2,
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

CREATE TABLE IF NOT EXISTS gd_invitations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY (session_code, to_user_id)
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

-- Solo Practice Sessions
CREATE TABLE IF NOT EXISTS solo_practice_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    topic TEXT NOT NULL,
    status ENUM('preparation', 'speaking', 'completed') NOT NULL DEFAULT 'preparation',
    transcript TEXT,
    overall_score DECIMAL(5,2),
    fluency_score DECIMAL(5,2),
    grammar_score DECIMAL(5,2),
    accent_score DECIMAL(5,2),
    delivery_score DECIMAL(5,2),
    weaknesses TEXT,
    improvement_tips TEXT,
    session_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS solo_practice_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    total_sessions INT NOT NULL DEFAULT 0,
    seen_quote_ids TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS motivational_quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quote TEXT NOT NULL,
    author VARCHAR(100) NOT NULL DEFAULT 'Unknown'
);

INSERT IGNORE INTO motivational_quotes (id, quote, author) VALUES
(1, 'The only way to do great work is to love what you do.', 'Steve Jobs'),
(2, 'Believe you can and you are halfway there.', 'Theodore Roosevelt'),
(3, 'Your limitation—it is only your imagination.', 'Unknown'),
(4, 'Push yourself because no one else is going to do it for you.', 'Unknown'),
(5, 'Great things never come from comfort zones.', 'Unknown'),
(6, 'Dream it. Wish it. Do it.', 'Unknown'),
(7, 'Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill'),
(8, 'The future depends on what you do today.', 'Mahatma Gandhi'),
(9, 'It always seems impossible until it is done.', 'Nelson Mandela'),
(10, 'You are braver than you believe, stronger than you seem, and smarter than you think.', 'A.A. Milne'),
(11, 'The only person you are destined to become is the person you decide to be.', 'Ralph Waldo Emerson'),
(12, 'Everything you have ever wanted is on the other side of fear.', 'George Addair'),
(13, 'Success usually comes to those who are too busy to be looking for it.', 'Henry David Thoreau'),
(14, 'Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'),
(15, 'The secret of getting ahead is getting started.', 'Mark Twain'),
(16, 'You miss 100% of the shots you don\'t take.', 'Wayne Gretzky'),
(17, 'Act as if what you do makes a difference. It does.', 'William James'),
(18, 'What lies behind us and what lies before us are tiny matters compared to what lies within us.', 'Ralph Waldo Emerson'),
(19, 'The best time to plant a tree was 20 years ago. The second best time is now.', 'Chinese Proverb'),
(20, 'Hardships often prepare ordinary people for an extraordinary destiny.', 'C.S. Lewis'),
(21, 'Believe in yourself and all that you are. Know that there is something inside you that is greater than any obstacle.', 'Christian D. Larson'),
(22, 'The mind is everything. What you think you become.', 'Buddha'),
(23, 'Strive not to be a success, but rather to be of value.', 'Albert Einstein'),
(24, 'Do what you can, with what you have, where you are.', 'Theodore Roosevelt'),
(25, 'The only impossible journey is the one you never begin.', 'Tony Robbins');

-- Easy topics for GD Live (simple enough for anyone)
CREATE TABLE IF NOT EXISTS gd_easy_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO gd_easy_topics (id, topic) VALUES
(1, 'My favorite animal and why I like it'),
(2, 'What I like to do on weekends'),
(3, 'My favorite food'),
(4, 'A happy memory from my childhood'),
(5, 'What I want to become when I grow up'),
(6, 'My best friend'),
(7, 'A game I love to play'),
(8, 'My favorite season and why'),
(9, 'What makes me happy'),
(10, 'A place I want to visit'),
(11, 'My favorite subject in school'),
(12, 'Something I learned recently'),
(13, 'The best gift I ever received'),
(14, 'My favorite movie or cartoon'),
(15, 'What I do to help at home'),
(16, 'A skill I want to learn'),
(17, 'My favorite holiday'),
(18, 'An interesting dream I had'),
(19, 'A person I admire'),
(20, 'What peace means to me');

-- Anonymous GD Live sessions (4-digit code)
CREATE TABLE IF NOT EXISTS gd_live_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL UNIQUE,
    status ENUM('waiting', 'active', 'completed') NOT NULL DEFAULT 'waiting',
    total_participants INT NOT NULL DEFAULT 0,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Teams within a live session
CREATE TABLE IF NOT EXISTS gd_live_teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL,
    team_number INT NOT NULL,
    topic VARCHAR(255) NOT NULL,
    status ENUM('waiting', 'active', 'completed') NOT NULL DEFAULT 'waiting',
    FOREIGN KEY (session_code) REFERENCES gd_live_sessions(session_code) ON DELETE CASCADE
);

-- Participants in live sessions (anonymous to each other)
CREATE TABLE IF NOT EXISTS gd_live_participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL,
    user_id INT NOT NULL,
    team_number INT,
    anonymous_label VARCHAR(20),
    transcript TEXT,
    status ENUM('joined', 'assigned', 'completed') NOT NULL DEFAULT 'joined',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (session_code, user_id),
    FOREIGN KEY (session_code) REFERENCES gd_live_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Students are seeded via backend/seed.py with proper bcrypt hashes
