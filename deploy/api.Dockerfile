# API (Spring Boot 3, Java 21). Контекст сборки — корень репозитория:
# pom.xml берёт общие JSON (машины, тюнинг, магазин) из packages/shared/src.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY apps/api/pom.xml apps/api/pom.xml
RUN cd apps/api && mvn -q -B dependency:go-offline
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
RUN cd apps/api && mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/apps/api/target/api-0.1.0.jar /app/api.jar
RUN useradd --system --uid 10001 api
USER api
ENV SPRING_PROFILES_ACTIVE=prod
EXPOSE 8080
CMD ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/api.jar"]
