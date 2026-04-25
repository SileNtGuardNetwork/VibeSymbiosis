-- Один ряд прогресса на пару (user_id, lesson_number) для upsert из вебхука
alter table public.progress
  add constraint progress_user_id_lesson_number_key unique (user_id, lesson_number);
