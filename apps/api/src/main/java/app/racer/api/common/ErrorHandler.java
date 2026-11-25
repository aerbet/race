package app.racer.api.common;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ErrorHandler {
  @ExceptionHandler(ApiException.class)
  public ResponseEntity<Map<String, String>> api(ApiException e) {
    return ResponseEntity.status(e.status).body(Map.of("error", e.code, "message", e.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, String>> invalid(MethodArgumentNotValidException e) {
    var f = e.getBindingResult().getFieldError();
    String msg = f == null ? "некорректный запрос" : f.getField() + ": " + f.getDefaultMessage();
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "validation", "message", msg));
  }
}
